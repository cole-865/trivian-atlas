import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.generated";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEligible, type Evaluation } from "./domain";
import { callDb, saveEvaluation, type CallSettings } from "./store";
import { MediaError } from "./media";
import type { RecordingDiscovery } from "./ringcentral";
import type { RecordingJob, SavedAnalysis } from "./pipeline";
import { playbackSource, type PlaybackJob } from "./playback";

type JobRow = { id: string; organization_id: string; provider_account_id: string; provider_call_id: string; job_data: Json;
  state: "queued" | "running" | "completed" | "failed"; attempts: number; lease_token: string | null; lease_until: string | null;
  available_at: string; archive_file_id: string | null; archive_md5: string | null; archive_bytes: number | null;
  recording_expires_at: string | null; last_error: string | null; created_at: string };
type JobDatabase = { public: Omit<Database["public"], "Tables" | "Functions"> & {
  Tables: Database["public"]["Tables"] & { ask865_recording_jobs: { Row: JobRow; Insert: Partial<JobRow>; Update: Partial<JobRow>; Relationships: [] };
    ask865_recording_access: { Row: { id: string; organization_id: string; job_id: string; actor_id: string; accessed_at: string }; Insert: { organization_id: string; job_id: string; actor_id: string }; Update: never; Relationships: [] } };
  Functions: Database["public"]["Functions"] & { atlas_ask865_claim_recording: { Args: { p_organization_id: string; p_provider_account_id: string }; Returns: JobRow[] } };
} };
function db() { return createAdminClient() as unknown as SupabaseClient<JobDatabase>; }
const jobData = z.object({ recordingIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).min(1).max(500),
  direction: z.enum(["inbound", "outbound"]), startedAt: z.iso.datetime({ offset: true }), durationSeconds: z.number().int().min(0).max(14400), employeeId: z.string().nullable() }).strict();

function playbackJob(row: JobRow): PlaybackJob | null {
  const metadata = jobData.safeParse(row.job_data);
  if (!metadata.success || metadata.data.recordingIds.length !== 1 || row.state !== "completed") return null;
  return { jobId: row.id, recordingId: metadata.data.recordingIds[0], expiresAt: row.recording_expires_at,
    receipt: row.archive_file_id && row.archive_md5 && row.archive_bytes
      ? { fileId: row.archive_file_id, md5: row.archive_md5, bytes: row.archive_bytes } : null };
}
export async function recordingInboxStatus(org: string, providerCallIds: string[], account: string | null) {
  const counts = await Promise.all((["queued", "running", "failed"] as const).map(async state => {
    const result = await db().from("ask865_recording_jobs").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("state", state);
    if (result.error) throw new MediaError("queue_unavailable"); return result.count ?? 0;
  }));
  const availableProviderCallIds: string[] = [], providerPlaybackCallIds: string[] = [];
  if (providerCallIds.length && account) {
    const [jobs, calls] = await Promise.all([
      db().from("ask865_recording_jobs").select("*").eq("organization_id", org).eq("provider_account_id", account).eq("state", "completed").in("provider_call_id", providerCallIds),
      callDb().from("ask865_call_reviews").select("provider_call_id,category,consent_reference,recording_id,expires_at,evaluation").eq("organization_id", org)
        .gt("expires_at", new Date().toISOString()).in("provider_call_id", providerCallIds),
    ]);
    if (jobs.error || calls.error) throw new MediaError("queue_unavailable");
    for (const call of calls.data) {
      const row = jobs.data.find(job => job.provider_call_id === call.provider_call_id);
      const source = playbackSource(call, row ? playbackJob(row) : null);
      if (source) availableProviderCallIds.push(call.provider_call_id);
      if (source === "provider") providerPlaybackCallIds.push(call.provider_call_id);
    }
  }
  return { queued: counts[0], running: counts[1], failed: counts[2], availableProviderCallIds, providerPlaybackCallIds };
}
export async function recordingForPlayback(org: string, providerCallId: string, account: string) {
  const result = await db().from("ask865_recording_jobs").select("*").eq("organization_id", org).eq("provider_account_id", account).eq("provider_call_id", providerCallId)
    .eq("state", "completed").maybeSingle();
  if (result.error) throw new MediaError("recording_unavailable");
  return result.data ? playbackJob(result.data) : null;
}
export async function logRecordingAccess(org: string, jobId: string, actorId: string) {
  const result = await db().from("ask865_recording_access").insert({ organization_id: org, job_id: jobId, actor_id: actorId });
  if (result.error) throw new MediaError("access_audit_failed");
}

export async function enqueueRecordings(org: string, account: string, calls: RecordingDiscovery[], employeeForCall: (call: RecordingDiscovery) => string | null = () => null) {
  const rows = calls.filter(c => c.recordingIds.length).map(c => ({ organization_id: org, provider_account_id: account, provider_call_id: c.callId,
    job_data: jobData.parse({ recordingIds: c.recordingIds, direction: c.direction, startedAt: c.startedAt, durationSeconds: c.durationSeconds, employeeId: employeeForCall(c) }) }));
  if (!rows.length) return 0;
  const result = await db().from("ask865_recording_jobs").upsert(rows, { onConflict: "organization_id,provider_account_id,provider_call_id", ignoreDuplicates: true }).select("id");
  if (result.error) throw new MediaError("queue_save_failed");
  return result.data?.length ?? 0;
}
export async function claimRecording(org: string, account: string) {
  const { data, error } = await db().rpc("atlas_ask865_claim_recording", { p_organization_id: org, p_provider_account_id: account });
  if (error) throw new MediaError("queue_unavailable");
  const row = data?.[0]; if (!row) return null;
  const job: RecordingJob = { ...jobData.parse(row.job_data), id: row.id, providerCallId: row.provider_call_id, archiveFileId: row.archive_file_id };
  return { row, job };
}
export function recordingJobStore(row: JobRow, settings: CallSettings) {
  async function change(values: Partial<JobRow>) {
    const result = await db().from("ask865_recording_jobs").update(values).eq("organization_id", row.organization_id).eq("provider_account_id", row.provider_account_id).eq("id", row.id)
      .eq("state", "running").eq("lease_token", row.lease_token!).gt("lease_until", new Date().toISOString()).select("id").maybeSingle();
    if (result.error || !result.data) throw new MediaError("recording_lease_lost");
  }
  async function loadAnalysis(): Promise<SavedAnalysis | null> {
    const result = await callDb().from("ask865_call_reviews").select("evaluation,category,expires_at").eq("organization_id", row.organization_id).eq("provider_call_id", row.provider_call_id).maybeSingle();
    if (result.error) throw new MediaError("review_lookup_failed");
    if (!result.data) return null;
    const evaluation = result.data.evaluation;
    return { evaluation, archiveEligible: Date.parse(result.data.expires_at) > Date.now() && isEligible(result.data.category) && result.data.category === evaluation.category && !evaluation.reasons.includes("low_confidence") && (evaluation.assessment?.classificationConfidence ?? 0) >= settings.confidence_threshold };
  }
  return {
    async assertLease() {
      // No mutation: the same org/account/token predicate protects every checkpoint.
      const result = await db().from("ask865_recording_jobs").select("id").eq("organization_id", row.organization_id).eq("provider_account_id", row.provider_account_id)
        .eq("id", row.id).eq("state", "running").eq("lease_token", row.lease_token!).gt("lease_until", new Date().toISOString()).maybeSingle();
      if (result.error || !result.data) throw new MediaError("recording_lease_lost");
    },
    loadAnalysis,
    async saveAnalysis(input: Parameters<typeof saveEvaluation>[1], evaluation: Evaluation) {
      await saveEvaluation(row.organization_id, input, evaluation, settings);
      const saved = await loadAnalysis(); if (!saved) throw new MediaError("review_save_failed"); return saved;
    },
    async saveArchiveId(fileId: string) {
      // The lease gives one owner. A preallocated ID is committed before any upload.
      await change({ archive_file_id: fileId });
    },
    async complete(receipt: { fileId: string; md5: string; bytes: number } | null, expiresAt: string | null) {
      await change({ state: "completed", lease_token: null, lease_until: null,
        ...(receipt ? { archive_file_id: receipt.fileId, archive_md5: receipt.md5, archive_bytes: receipt.bytes, recording_expires_at: expiresAt } : {}) });
    },
    async fail(code: string) {
      await change({ state: row.attempts >= 3 ? "failed" : "queued", lease_token: null, lease_until: null,
        available_at: new Date(Date.now() + 15 * 60000).toISOString(), last_error: /^[a-z_]{1,100}$/.test(code) ? code : "processing_failed" });
    },
  };
}
