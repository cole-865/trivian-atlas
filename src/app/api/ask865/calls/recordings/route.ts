import { z } from "zod";
import { Ask865AccessError, getAsk865Module } from "@/lib/ask865/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeWithOpenAI } from "@/lib/ask865/calls/analyzer";
import { loadCallSettings } from "@/lib/ask865/calls/store";
import { boundedJson, callError, privateHeaders, validIngestToken } from "@/lib/ask865/calls/http";
import { RingCentralClient, ringCentralConfig } from "@/lib/ask865/calls/ringcentral";
import { PrivateDriveArchive } from "@/lib/ask865/calls/drive";
import { transcribeAudio } from "@/lib/ask865/calls/transcription";
import { redactTranscript } from "@/lib/ask865/calls/privacy";
import { processRecordingJob, type PipelinePolicy } from "@/lib/ask865/calls/pipeline";
import { claimRecording, enqueueRecordings, recordingJobStore } from "@/lib/ask865/calls/jobs";
import { MediaError } from "@/lib/ask865/calls/media";
import { employeeMapper } from "@/lib/ask865/calls/employeeMapping";

export const runtime = "nodejs";
export const maxDuration = 600;
const payloadSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("discover"), dateFrom: z.iso.datetime({ offset: true }), dateTo: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ action: z.literal("process_one") }).strict(),
]);
function required(key: string) { const value = process.env[key]?.trim(); if (!value) throw new MediaError("recording_configuration_required"); return value; }

export async function POST(request: Request) {
  try {
    if (!validIngestToken(request.headers.get("authorization"), process.env.ASK865_CALLS_INGEST_TOKEN)) throw new Ask865AccessError(401, "Unauthorized importer.");
    if (process.env.ASK865_CALLS_ENABLED !== "true" || process.env.ASK865_CALLS_RECORDINGS_ENABLED !== "true") throw new Ask865AccessError(503, "Direct recording processing is disabled.");
    const org = z.uuid().safeParse(process.env.ASK865_CALLS_ORGANIZATION_ID);
    if (!org.success) throw new Ask865AccessError(503, "Importer organization is not configured.");
    const { data: organization, error } = await createAdminClient().from("organizations").select("is_active").eq("id", org.data).maybeSingle();
    if (error || !organization?.is_active || !(await getAsk865Module(org.data))?.enabled) throw new Ask865AccessError(403, "Call ingestion is unavailable for this dealership.");
    const settings = await loadCallSettings(org.data), config = ringCentralConfig(process.env);
    if (!settings.enabled || !settings.policy_version || settings.provider_account_id !== config.accountId) throw new Ask865AccessError(503, "Recording policy and provider account are not configured.");
    const payload = payloadSchema.safeParse(await boundedJson(request, 4096));
    if (!payload.success) throw new Ask865AccessError(400, "Invalid recording request.");
    const ringcentral = new RingCentralClient(config);
    if (payload.data.action === "discover") {
      const found = await ringcentral.discover(payload.data.dateFrom, payload.data.dateTo, 10);
      // Caller retains its checkpoint until a complete window has been enqueued.
      if (!found.complete) throw new Ask865AccessError(409, "Call window is incomplete. Retry with a smaller window.");
      const queued = await enqueueRecordings(org.data, config.accountId, found.calls, employeeMapper(process.env.ASK865_CALLS_EMPLOYEE_MAPPING));
      return Response.json({ status: "discovered", callsObserved: found.calls.length, newlyQueued: queued, complete: true }, { headers: privateHeaders });
    }
    if (process.env.ASK865_CALLS_CONSENT_APPROVED !== "true") throw new Ask865AccessError(503, "Recording and AI-processing consent must be verified.");
    const policy: PipelinePolicy = { consentReference: required("ASK865_CALLS_CONSENT_REFERENCE"), approvedFrom: required("ASK865_CALLS_CONSENT_FROM"), approvedThrough: required("ASK865_CALLS_CONSENT_THROUGH"),
      confidenceThreshold: settings.confidence_threshold, qualityCalibrationApproved: process.env.ASK865_CALLS_QUALITY_CALIBRATED === "true" };
    const apiKey = required("ASK865_CALLS_OPENAI_KEY"), model = required("ASK865_CALLS_MODEL"), transcriptionModel = required("ASK865_CALLS_TRANSCRIPTION_MODEL");
    const drive = new PrivateDriveArchive({ clientId: required("ASK865_DRIVE_CLIENT_ID"), clientSecret: required("ASK865_DRIVE_CLIENT_SECRET"), refreshToken: required("ASK865_DRIVE_REFRESH_TOKEN"),
      ownerPermissionId: required("ASK865_DRIVE_OWNER_PERMISSION_ID"), folderId: required("ASK865_DRIVE_ARCHIVE_FOLDER_ID") });
    await drive.verifyDestination(); // Missing authorization never consumes a job attempt or downloads audio.
    const claimed = await claimRecording(org.data, config.accountId);
    if (!claimed) return Response.json({ status: "idle" }, { headers: privateHeaders });
    const ports = recordingJobStore(claimed.row, settings);
    try {
      const result = await processRecordingJob(claimed.job, policy, { ...ports,
        download: id => ringcentral.downloadRecording(id),
        transcribe: (audio, duration) => transcribeAudio(audio, duration, { apiKey, model: transcriptionModel }),
        redact: (raw, duration) => redactTranscript(raw, duration, { apiKey, model }),
        analyze: analyzeWithOpenAI,
        allocateArchiveId: () => drive.allocateFileId(),
        archive: async (fileId, recordingId, audio) => {
          const latest = await ports.loadAnalysis();
          if (!latest?.archiveEligible) throw new MediaError("archive_classification_changed");
          return drive.upload(fileId, { organizationId: org.data, accountId: config.accountId, recordingId }, audio);
        },
      });
      return Response.json({ status: "processed", ...result }, { headers: privateHeaders });
    } catch (error) {
      const code = error instanceof MediaError ? error.code : "processing_failed";
      await ports.fail(code);
      return Response.json({ status: claimed.row.attempts >= 3 ? "manual_attention_required" : "retry_queued", code }, { status: 503, headers: privateHeaders });
    }
  } catch (error) { return callError(error); }
}
