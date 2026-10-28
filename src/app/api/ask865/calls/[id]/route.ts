import type { NextRequest } from "next/server";
import { z } from "zod";
import { Ask865AccessError } from "@/lib/ask865/access";
import { matchesAsk865Organization } from "@/lib/ask865/accessRules";
import { isSameOriginReview } from "@/lib/ask865/review";
import { getCallAccess } from "@/lib/ask865/calls/access";
import { callDb, loadCallAudit } from "@/lib/ask865/calls/store";
import { correctionSchema } from "@/lib/ask865/calls/domain";
import { boundedJson, callError, privateHeaders } from "@/lib/ask865/calls/http";

type Context = { params: Promise<{ id: string }> };
async function scope(request: NextRequest, context: Context, write = false) {
  if (write && !isSameOriginReview(request.headers.get("origin"), request.headers.get("host"))) throw new Ask865AccessError(403, "Invalid request origin.");
  const access = await getCallAccess(write);
  if (!matchesAsk865Organization(access.organizationId, request.nextUrl.searchParams.get("organization"))) throw new Ask865AccessError(409, "Your dealership changed. Reload the page.");
  const id = (await context.params).id;
  if (!z.uuid().safeParse(id).success) throw new Ask865AccessError(400, "Invalid call.");
  return { access, id };
}
export async function GET(request: NextRequest, context: Context) {
  try {
    const { access, id } = await scope(request, context);
    return Response.json({ audit: await loadCallAudit(access.organizationId, id) }, { headers: privateHeaders });
  } catch (error) { return callError(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { access, id } = await scope(request, context, true);
    const result = correctionSchema.safeParse(await boundedJson(request, 8000));
    if (!result.success) throw new Ask865AccessError(400, "Invalid correction. Include a reason and a score from 0–100, or leave the score blank.");
    const body = result.data;
    const { data, error } = await callDb().rpc("atlas_ask865_correct_call", {
      p_organization_id: access.organizationId, p_call_id: id, p_actor_id: access.actorId,
      p_expected_revision: body.expectedRevision, p_category: body.category, p_score: body.score,
      p_status: body.status, p_reason: body.reason,
    });
    if (error?.code === "40001") throw new Ask865AccessError(409, "Another manager changed this review. Reload before saving.");
    if (error?.code === "P0002") throw new Ask865AccessError(404, "Call not found.");
    if (error?.code === "23514") throw new Ask865AccessError(400, "This call is not eligible for a score.");
    if (error || !data) throw new Error("Correction failed");
    return Response.json({ status: "saved", revision: data }, { headers: privateHeaders });
  } catch (error) { return callError(error); }
}
