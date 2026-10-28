import { analyzeCall, callInputSchema, isEligible, rubricVersion, type CallInput, type Evaluation } from "./domain";
import { MediaError, type PrivateAudio } from "./media";
import type { PrivacyResult } from "./privacy";
import { validateTranscript, type RawTranscript } from "./transcription";
import type { ArchiveReceipt } from "./drive";
import { earlyExclusion, purposeVersion, type CallPurpose } from "./purpose";

import { orderedRecordingParts, joinRecordingTranscripts, type RecordingPart, type PartArchive } from "./conversation";

export type RecordingJob = { id: string; providerCallId: string; recordingIds: string[]; recordingParts?: RecordingPart[]; partArchives?: PartArchive[]; direction: "inbound" | "outbound"; startedAt: string; durationSeconds: number; employeeId: string | null; archiveFileId: string | null };
export type PipelinePolicy = { consentReference: string; approvedFrom: string; approvedThrough: string; confidenceThreshold: number; qualityCalibrationApproved: boolean };
export type SavedAnalysis = { evaluation: Evaluation; archiveEligible: boolean };
export type PipelinePorts = {
  assertLease(): Promise<void>;
  loadAnalysis(): Promise<SavedAnalysis | null>;
  download(recordingId: string): Promise<PrivateAudio>;
  transcribe(audio: PrivateAudio, duration: number): Promise<RawTranscript>;
  screenPurpose(raw: RawTranscript, duration: number): Promise<CallPurpose>;
  redact(raw: RawTranscript, duration: number): Promise<PrivacyResult>;
  analyze: Parameters<typeof analyzeCall>[1];
  saveAnalysis(input: CallInput, evaluation: Evaluation): Promise<SavedAnalysis>;
  allocateArchiveId(): Promise<string>;
  saveArchiveId(fileId: string): Promise<void>;
  savePartArchive?(checkpoint: PartArchive): Promise<void>;
  archive(fileId: string, recordingId: string, audio: PrivateAudio): Promise<ArchiveReceipt>;
  complete(receipt: ArchiveReceipt | null, expiresAt: string | null): Promise<void>;
};
export function fiveYearExpiry(startedAt: string) {
  const date = new Date(startedAt); if (!Number.isFinite(date.getTime())) throw new MediaError("invalid_call_date");
  const month = date.getUTCMonth(); date.setUTCFullYear(date.getUTCFullYear() + 5);
  if (date.getUTCMonth() !== month) date.setUTCDate(0); // Feb 29 -> Feb 28
  return date.toISOString();
}
export function policyCovers(job: RecordingJob, policy: PipelinePolicy, now = Date.now()) {
  const start = Date.parse(job.startedAt), from = Date.parse(policy.approvedFrom), through = Date.parse(policy.approvedThrough);
  return !!policy.consentReference.trim() && Number.isFinite(start) && Number.isFinite(from) && Number.isFinite(through) && from < through && start >= from && start + job.durationSeconds * 1000 <= through && start <= now && Number.isFinite(policy.confidenceThreshold) && policy.confidenceThreshold >= 0.5 && policy.confidenceThreshold <= 1;
}
export async function processRecordingJob(job: RecordingJob, policy: PipelinePolicy, ports: PipelinePorts, now = Date.now()) {
  // Consent covers the entire call and both provider/AI processing. It comes from
  // server configuration, never the caller's request or a model's inference.
  if (!policyCovers(job, policy, now)) throw new MediaError("consent_review_required");
  let parts: RecordingPart[] = [];
  let manifestError: string | undefined;
  if (job.recordingIds.length > 1) {
    try { parts = orderedRecordingParts(job.recordingIds, job.recordingParts, job.durationSeconds); }
    catch (e) { manifestError = e instanceof MediaError ? e.code : "recording_manifest_required"; }
  } else if (job.recordingIds.length === 1) parts = [{ recordingId: job.recordingIds[0], offsetSeconds: 0, durationSeconds: job.durationSeconds }];
  else manifestError = "no_recording";
  const conversation = parts.length > 1 ? { parts: parts.map(({ offsetSeconds, durationSeconds }) => ({ offsetSeconds, durationSeconds })) } : undefined;
  const base = callInputSchema.parse({ providerCallId: job.providerCallId, recordingId: parts[0]?.recordingId ?? null,
    employeeId: conversation ? null : job.employeeId, ...(conversation ? { conversation } : {}), startedAt: job.startedAt, direction: job.direction, durationSeconds: job.durationSeconds,
    connected: true, consent: "approved", consentReference: policy.consentReference, redacted: false, transcriptConfidence: 0, transcript: [] });
  await ports.assertLease();
  if (manifestError) {
    await ports.saveAnalysis(base, { category: "unknown", score: null, state: "manual_review", reasons: [manifestError], assessment: null, rubricVersion });
    await ports.complete(null, null); return { state: "manual_review", archived: false };
  }
  const audio = new Map<string, PrivateAudio>();
  let totalBytes = 0;
  async function download(part: RecordingPart) {
    const existing = audio.get(part.recordingId); if (existing) return existing;
    await ports.assertLease();
    const result = await ports.download(part.recordingId);
    audio.set(part.recordingId, result); totalBytes += result.bytes.byteLength;
    if (totalBytes > 48_000_000) throw new MediaError("audio_size_limit");
    return result;
  }
  let purpose: CallPurpose | undefined;
  try {
    let saved = await ports.loadAnalysis();
    if (!saved) {
      const transcripts: RawTranscript[] = [];
      for (const part of parts) transcripts.push(validateTranscript(await ports.transcribe(await download(part), part.durationSeconds), part.durationSeconds));
      const raw = conversation ? joinRecordingTranscripts(parts, transcripts, job.durationSeconds) : transcripts[0];
      purpose = await ports.screenPurpose(raw, job.durationSeconds);
      const excluded = earlyExclusion(purpose, policy.confidenceThreshold);
      if (excluded) {
        // Keep only routing metadata, never raw transcript/audio or a grade.
        // This decision precedes privacy/quality review and does not approve either.
        await ports.assertLease();
        saved = await ports.saveAnalysis(base, { category: excluded, score: null, state: "excluded", reasons: [], assessment: null, rubricVersion,
          screening: { version: purposeVersion, category: excluded, confidence: purpose.confidence } });
        await ports.complete(null, null);
        return { state: saved.evaluation.state, archived: false };
      }
      const clean = await ports.redact(raw, job.durationSeconds);
      // Provider success supplies no calibrated confidence. Automatic grades stay
      // held until a labelled pilot validates the textual-quality estimator.
      const input = callInputSchema.parse({ ...base, redacted: true, transcript: clean.transcript,
        transcriptConfidence: Math.min(clean.qualityConfidence, clean.speakerRoleConfidence) });
      const evaluation = await analyzeCall(input, ports.analyze, policy.confidenceThreshold);
      evaluation.screening = { version: purposeVersion, category: purpose.category, confidence: purpose.confidence };
      if (purpose.criticalConcern && !evaluation.reasons.includes("critical_flag")) evaluation.reasons.push("critical_flag");
      if (conversation) evaluation.conversation = conversation;
      if (!policy.qualityCalibrationApproved && isEligible(evaluation.category)) {
        // A suggested pilot score is never an approved score or an employee metric.
        if (evaluation.score !== null) evaluation.provisionalScore = evaluation.score;
        evaluation.score = null; evaluation.state = "manual_review";
        if (!evaluation.reasons.includes("low_confidence")) evaluation.reasons.push("low_confidence");
        evaluation.reasons.push("quality_calibration_required");
      }
      await ports.assertLease(); saved = await ports.saveAnalysis(input, evaluation);
    }
    if (!saved.archiveEligible) { await ports.complete(null, null); return { state: saved.evaluation.state, archived: false }; }
    await ports.assertLease();
    if (conversation) {
      if (!ports.savePartArchive) throw new MediaError("archive_manifest_required");
      for (const part of parts) {
        await ports.assertLease();
        const existing = job.partArchives?.find(p => p.recordingId === part.recordingId);
        const fileId = existing?.fileId ?? await ports.allocateArchiveId();
        if (!existing) await ports.savePartArchive({ recordingId: part.recordingId, fileId, receipt: null, expiresAt: null });
        // upload verifies the existing file on a retry before accepting its receipt.
        const receipt = await ports.archive(fileId, part.recordingId, await download(part));
        await ports.savePartArchive({ recordingId: part.recordingId, fileId, receipt, expiresAt: fiveYearExpiry(job.startedAt) });
      }
      await ports.complete(null, null);
      return { state: saved.evaluation.state, archived: true };
    }
    const fileId = job.archiveFileId ?? await ports.allocateArchiveId();
    if (!job.archiveFileId) await ports.saveArchiveId(fileId);
    const singleAudio = await download(parts[0]);
    await ports.assertLease();
    const receipt = await ports.archive(fileId, job.recordingIds[0], singleAudio);
    await ports.complete(receipt, fiveYearExpiry(job.startedAt));
    return { state: saved.evaluation.state, archived: true };
  } catch (error) {
    if (error instanceof MediaError && ["privacy_review_required", "privacy_segment_mismatch", "invalid_transcript", "invalid_transcript_timestamps", "unsupported_audio", "audio_size_limit", "response_too_large"].includes(error.code)) {
      await ports.assertLease();
      // Human-review holds are not retried as provider outages. No raw evidence is
      // persisted or sent for grading when privacy/transcript validation fails.
      const category = purpose?.clearPurpose && purpose.confidence >= Math.max(0.95, policy.confidenceThreshold) && isEligible(purpose.category) ? purpose.category : "unknown";
      await ports.saveAnalysis(base, { category, score: null, state: "not_evaluable", reasons: [error.code], assessment: null, rubricVersion, ...(conversation ? { conversation } : {}),
        ...(purpose ? { screening: { version: purposeVersion, category: purpose.category, confidence: purpose.confidence } } : {}) });
      await ports.complete(null, null); return { state: "manual_review", archived: false };
    }
    throw error;
  } finally {
    // Best-effort buffer cleanup; JS strings/Blob copies cannot be securely erased.
    for (const item of audio.values()) item.bytes.fill(0);
  }
}
