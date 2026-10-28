import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.generated";
import { createAdminClient } from "@/lib/supabase/admin";
import { Ask865AccessError } from "../access";
import { coachingTrends, isExcluded, preflight, requiresManagementReview, type CallInput, type CallRecord, type Evaluation } from "./domain";

export type CallSettings = { organization_id: string; enabled: boolean; confidence_threshold: number;
  grade_retention_days: number; grade_retention_years?: number | null; scheduler_enabled?: boolean; excluded_retention_days: number; policy_version: string | null; provider_account_id: string | null };
type StoredCall = CallRecord & { recording_id: string | null; consent_reference: string | null; scoring_allowed: boolean; policy_version: string; analyzer_model: string | null };
export type AuditEntry = { id: string; organization_id: string; call_id: string; actor_id: string; reason: string; before_state: Json; after_state: Json; created_at: string };
type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
// Local schema extension until db:types is regenerated after migration rollout.
type CallDatabase = { public: Omit<Database["public"], "Tables" | "Functions"> & {
  Tables: Database["public"]["Tables"] & {
    ask865_call_settings: Table<CallSettings>;
    ask865_call_reviews: Table<StoredCall>;
    ask865_call_audit: Table<AuditEntry>;
  };
  Functions: Database["public"]["Functions"] & {
    atlas_ask865_correct_call: { Args: { p_organization_id: string; p_call_id: string; p_actor_id: string;
      p_expected_revision: number; p_category: string; p_score: number | null; p_status: string; p_reason: string }; Returns: number };
  };
} };

// RLS has no browser policies. This server client intentionally uses the existing
// service role ONLY after org/module/permission checks in each caller.
export function callDb() { return createAdminClient() as unknown as SupabaseClient<CallDatabase>; }
export async function loadCallSettings(organizationId: string) {
  const { data, error } = await callDb().from("ask865_call_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (error || !data) throw new Ask865AccessError(503, "Call Intelligence has not been configured for this dealership.");
  return data;
}

export async function findImportedCall(organizationId: string, providerCallId: string) {
  const { data, error } = await callDb().from("ask865_call_reviews").select("id,revision")
    .eq("organization_id", organizationId).eq("provider_call_id", providerCallId).maybeSingle();
  if (error) throw new Error("Call lookup failed");
  return data;
}

export async function saveEvaluation(organizationId: string, input: CallInput, evaluation: Evaluation, settings: CallSettings) {
  const days = isExcluded(evaluation.category) ? settings.excluded_retention_days : settings.grade_retention_days;
  const expiresAt = new Date(Date.parse(input.startedAt) + days * 86400000);
  if (!isExcluded(evaluation.category) && settings.grade_retention_years) {
    expiresAt.setTime(Date.parse(input.startedAt)); const month = expiresAt.getUTCMonth();
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + settings.grade_retention_years);
    if (expiresAt.getUTCMonth() !== month) expiresAt.setUTCDate(0);
  }
  if (expiresAt.getTime() <= Date.now()) throw new Ask865AccessError(410, "Call is outside the retention window.");
  const { data, error } = await callDb().from("ask865_call_reviews").upsert({
    organization_id: organizationId, provider_call_id: input.providerCallId,
    recording_id: isExcluded(evaluation.category) ? null : input.recordingId,
    employee_id: input.employeeId, started_at: input.startedAt, direction: input.direction,
    category: evaluation.category, score: evaluation.score, ai_category: evaluation.category, ai_score: evaluation.score,
    evaluation, scoring_allowed: preflight(input).length === 0,
    consent_reference: input.consentReference, policy_version: settings.policy_version!,
    analyzer_model: preflight(input).length ? null : process.env.ASK865_CALLS_MODEL ?? null,
    status: requiresManagementReview(evaluation) ? "needs_review" : "not_required", expires_at: expiresAt.toISOString(),
  }, { onConflict: "organization_id,provider_call_id", ignoreDuplicates: true }).select("id,revision").maybeSingle();
  if (error) throw new Error("Call save failed");
  // A racing/retried import must never overwrite a manager's corrections.
  return data ?? await findImportedCall(organizationId, input.providerCallId);
}

const safeFields = "id,organization_id,provider_call_id,employee_id,direction,started_at,category,score,ai_category,ai_score,evaluation,status,revision,expires_at,created_at";
export async function loadCallInbox(organizationId: string, page: number, view: "inbox" | "all") {
  let query = callDb().from("ask865_call_reviews").select(safeFields, { count: "exact" })
    .eq("organization_id", organizationId).gt("expires_at", new Date().toISOString());
  if (view === "inbox") query = query.in("status", ["needs_review", "in_review", "coaching_assigned"]);
  const result = await query.order("started_at", { ascending: false }).order("id").range(page * 50, page * 50 + 49);
  if (result.error) throw new Error("Call inbox unavailable");
  const { data: recent, error } = await callDb().from("ask865_call_reviews").select(safeFields)
    .eq("organization_id", organizationId).gte("started_at", new Date(Date.now() - 7 * 86400000).toISOString())
    .gt("expires_at", new Date().toISOString()).order("started_at", { ascending: false }).order("id").limit(1001);
  if (error) throw new Error("Call trends unavailable");
  const trendsLimited = (recent?.length ?? 0) > 1000;
  return { calls: result.data ?? [], total: result.count ?? 0,
    trends: coachingTrends((recent ?? []).slice(0, 1000)), trendsLimited };
}

export async function loadCallAudit(organizationId: string, callId: string) {
  const { data: call, error: callError } = await callDb().from("ask865_call_reviews").select("id")
    .eq("organization_id", organizationId).eq("id", callId).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (callError) throw new Error("Call unavailable");
  if (!call) throw new Ask865AccessError(404, "Call not found.");
  const { data, error } = await callDb().from("ask865_call_audit").select("*")
    .eq("organization_id", organizationId).eq("call_id", callId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("Audit unavailable");
  return data ?? [];
}
