import { z } from "zod";
import { Ask865AccessError, getAsk865Module } from "@/lib/ask865/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeCall, callInputSchema, requiresManagementReview, rubricVersion, type Evaluation } from "@/lib/ask865/calls/domain";
import { analyzeWithOpenAI } from "@/lib/ask865/calls/analyzer";
import { findImportedCall, loadCallSettings, saveEvaluation } from "@/lib/ask865/calls/store";
import { boundedJson, callError, privateHeaders, validIngestToken } from "@/lib/ask865/calls/http";

export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(request: Request) {
  try {
    if (!validIngestToken(request.headers.get("authorization"), process.env.ASK865_CALLS_INGEST_TOKEN)) throw new Ask865AccessError(401, "Unauthorized importer.");
    if (process.env.ASK865_CALLS_ENABLED !== "true") throw new Ask865AccessError(503, "Call ingestion is disabled.");
    // A dedicated importer is bound to one configured org; payload cannot pick it.
    const organizationId = process.env.ASK865_CALLS_ORGANIZATION_ID;
    if (!z.uuid().safeParse(organizationId).success) throw new Ask865AccessError(503, "Importer organization is not configured.");
    const org = organizationId!;
    const { data: organization, error } = await createAdminClient().from("organizations").select("is_active").eq("id", org).maybeSingle();
    if (error || !organization?.is_active || !(await getAsk865Module(org))?.enabled) throw new Ask865AccessError(403, "Call ingestion is unavailable for this dealership.");
    const settings = await loadCallSettings(org);
    if (!settings.enabled || !settings.policy_version || !settings.provider_account_id) throw new Ask865AccessError(503, "Call privacy policy and importer are not configured.");
    const payload = z.object({ providerAccountId: z.string(), call: callInputSchema }).strict().safeParse(await boundedJson(request, 256000));
    if (!payload.success) throw new Ask865AccessError(400, "Invalid call. Unverified consent requires metadata only.");
    if (payload.data.providerAccountId !== settings.provider_account_id) throw new Ask865AccessError(403, "Wrong recording account.");
    const call = payload.data.call;
    if (Date.parse(call.startedAt) > Date.now() + 300000) throw new Ask865AccessError(400, "Call date is in the future.");
    if (Date.parse(call.startedAt) + settings.grade_retention_days * 86400000 <= Date.now()) throw new Ask865AccessError(410, "Call is outside retention.");
    const existing = await findImportedCall(org, call.providerCallId);
    if (existing) return Response.json({ status: "already_imported", ...existing }, { headers: privateHeaders });
    let evaluation: Evaluation;
    try { evaluation = await analyzeCall(call, analyzeWithOpenAI, settings.confidence_threshold); }
    catch {
      evaluation = { category: "unknown", score: null, state: "manual_review", reasons: ["analysis_failed"], assessment: null, rubricVersion };
    }
    const saved = await saveEvaluation(org, call, evaluation, settings);
    if (!saved) throw new Error("Save unconfirmed");
    return Response.json({ status: "saved", ...saved, reviewRequired: requiresManagementReview(evaluation) }, { status: 201, headers: privateHeaders });
  } catch (error) { return callError(error); }
}
