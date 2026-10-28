import { analyzeCall, callInputSchema, rubricVersion, type CallInput, type Evaluation } from "./domain";
import { MediaError, type PrivateAudio } from "./media";
import type { PrivacyResult } from "./privacy";
import type { RawTranscript } from "./transcription";
import type { ArchiveReceipt } from "./drive";

export type RecordingJob = { id: string; providerCallId: string; recordingIds: string[]; direction: "inbound" | "outbound"; startedAt: string; durationSeconds: number; employeeId: string | null; archiveFileId: string | null };
export type PipelinePolicy = { consentReference: string; approvedFrom: string; approvedThrough: string; confidenceThreshold: number; qualityCalibrationApproved: boolean };
export type SavedAnalysis = { evaluation: Evaluation; archiveEligible: boolean };
export type PipelinePorts = {
  assertLease(): Promise<void>;
  loadAnalysis(): Promise<SavedAnalysis | null>;
  download(recordingId: string): Promise<PrivateAudio>;
  transcribe(audio: PrivateAudio, duration: number): Promise<RawTranscript>;
  redact(raw: RawTranscript, duration: number): Promise<PrivacyResult>;
  analyze: Parameters<typeof analyzeCall>[1];
  saveAnalysis(input: CallInput, evaluation: Evaluation): Promise<SavedAnalysis>;
  allocateArchiveId(): Promise<string>;
  saveArchiveId(fileId: string): Promise<void>;
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
  const base = callInputSchema.parse({ providerCallId: job.providerCallId, recordingId: job.recordingIds.length === 1 ? job.recordingIds[0] : null,
    employeeId: job.employeeId, startedAt: job.startedAt, direction: job.direction, durationSeconds: job.durationSeconds,
    connected: true, consent: "approved", consentReference: policy.consentReference, redacted: false, transcriptConfidence: 0, transcript: [] });
  await ports.assertLease();
  if (job.recordingIds.length !== 1) {
    await ports.saveAnalysis(base, { category: "unknown", score: null, state: "manual_review", reasons: ["multiple_recordings_require_review"], assessment: null, rubricVersion });
    await ports.complete(null, null); return { state: "manual_review", archived: false };
  }
  let audio: PrivateAudio | undefined;
  try {
    let saved = await ports.loadAnalysis();
    if (!saved) {
      audio = await ports.download(job.recordingIds[0]);
      const raw = await ports.transcribe(audio, job.durationSeconds);
      const clean = await ports.redact(raw, job.durationSeconds);
      // Provider success supplies no calibrated confidence. Automatic grades stay
      // held until a labelled pilot validates the textual-quality estimator.
      const input = callInputSchema.parse({ ...base, redacted: true, transcript: clean.transcript,
        transcriptConfidence: policy.qualityCalibrationApproved ? Math.min(clean.qualityConfidence, clean.speakerRoleConfidence) : 0 });
      const evaluation = await analyzeCall(input, ports.analyze, policy.confidenceThreshold);
      await ports.assertLease(); saved = await ports.saveAnalysis(input, evaluation);
    }
    if (!saved.archiveEligible) { await ports.complete(null, null); return { state: saved.evaluation.state, archived: false }; }
    await ports.assertLease();
    const fileId = job.archiveFileId ?? await ports.allocateArchiveId();
    if (!job.archiveFileId) await ports.saveArchiveId(fileId);
    audio ??= await ports.download(job.recordingIds[0]);
    await ports.assertLease();
    const receipt = await ports.archive(fileId, job.recordingIds[0], audio);
    await ports.complete(receipt, fiveYearExpiry(job.startedAt));
    return { state: saved.evaluation.state, archived: true };
  } catch (error) {
    if (error instanceof MediaError && ["privacy_review_required", "privacy_segment_mismatch", "invalid_transcript", "invalid_transcript_timestamps", "unsupported_audio", "audio_size_limit", "response_too_large"].includes(error.code)) {
      await ports.assertLease();
      // Human-review holds are not retried as provider outages. No raw evidence is
      // persisted or sent for grading when privacy/transcript validation fails.
      await ports.saveAnalysis(base, { category: "unknown", score: null, state: "not_evaluable", reasons: [error.code], assessment: null, rubricVersion });
      await ports.complete(null, null); return { state: "manual_review", archived: false };
    }
    throw error;
  } finally {
    // Best-effort buffer cleanup; JS strings/Blob copies cannot be securely erased.
    audio?.bytes.fill(0);
  }
}
