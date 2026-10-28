import type { NextRequest } from "next/server";
import { Ask865AccessError } from "@/lib/ask865/access";
import { matchesAsk865Organization } from "@/lib/ask865/accessRules";
import { getCallAccess } from "@/lib/ask865/calls/access";
import { loadCallInbox, loadCallSettings } from "@/lib/ask865/calls/store";
import { callError, privateHeaders } from "@/lib/ask865/calls/http";
import { recordingInboxStatus } from "@/lib/ask865/calls/jobs";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const access = await getCallAccess();
    if (!matchesAsk865Organization(access.organizationId, request.nextUrl.searchParams.get("organization"))) throw new Ask865AccessError(409, "Your dealership changed. Reload the page.");
    const page = Number(request.nextUrl.searchParams.get("page") ?? 0);
    if (!Number.isInteger(page) || page < 0 || page > 10000) throw new Ask865AccessError(400, "Invalid page.");
    const view = request.nextUrl.searchParams.get("view") === "all" ? "all" : "inbox";
    const settings = await loadCallSettings(access.organizationId);
    const inbox = await loadCallInbox(access.organizationId, page, view);
    const recordings = await recordingInboxStatus(access.organizationId, inbox.calls.map(call => call.provider_call_id));
    return Response.json({ ...inbox, recordings, playbackEnabled: process.env.ASK865_CALLS_PLAYBACK_ENABLED === "true",
      ingestionEnabled: settings.enabled && process.env.ASK865_CALLS_ENABLED === "true", page }, { headers: privateHeaders });
  } catch (error) { return callError(error); }
}
