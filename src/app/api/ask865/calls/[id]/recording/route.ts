import type { NextRequest } from "next/server";
import { z } from "zod";
import { Ask865AccessError } from "@/lib/ask865/access";
import { matchesAsk865Organization } from "@/lib/ask865/accessRules";
import { getCallAccess } from "@/lib/ask865/calls/access";
import { callDb, loadCallSettings } from "@/lib/ask865/calls/store";
import { isEligible } from "@/lib/ask865/calls/domain";
import { callError, privateHeaders } from "@/lib/ask865/calls/http";
import { recordingForPlayback, logRecordingAccess } from "@/lib/ask865/calls/jobs";
import { PrivateDriveArchive, driveEnvironment } from "@/lib/ask865/calls/drive";
import { audioByteRange, MediaError } from "@/lib/ask865/calls/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getCallAccess();
    if (!matchesAsk865Organization(access.organizationId, request.nextUrl.searchParams.get("organization"))) throw new Ask865AccessError(409, "Your dealership changed. Reload the page.");
    const id = (await context.params).id;
    if (!z.uuid().safeParse(id).success) throw new Ask865AccessError(400, "Invalid call.");
    const result = await callDb().from("ask865_call_reviews").select("provider_call_id,category,consent_reference").eq("organization_id", access.organizationId).eq("id", id).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (result.error) throw new Error("Recording lookup failed");
    if (!result.data || !isEligible(result.data.category) || !result.data.consent_reference) throw new Ask865AccessError(404, "Recording unavailable.");
    const settings = await loadCallSettings(access.organizationId);
    if (!settings.provider_account_id || !settings.policy_version || process.env.ASK865_CALLS_PLAYBACK_ENABLED !== "true") throw new Ask865AccessError(503, "Recording playback is disabled.");
    const recording = await recordingForPlayback(access.organizationId, result.data.provider_call_id, settings.provider_account_id);
    if (!recording) throw new Ask865AccessError(404, "Recording is not archived or has expired.");
    let range;
    try { range = audioByteRange(request.headers.get("range"), recording.receipt.bytes); }
    catch { return new Response(null, { status: 416, headers: { ...privateHeaders, "Content-Range": `bytes */${recording.receipt.bytes}` } }); }
    await logRecordingAccess(access.organizationId, recording.jobId, access.actorId);
    const audio = await new PrivateDriveArchive(driveEnvironment(process.env)).download(recording.receipt,
      { organizationId: access.organizationId, accountId: settings.provider_account_id, recordingId: recording.recordingId });
    try {
      const bytes = new Uint8Array(audio.bytes.slice(range.start, range.end + 1));
      return new Response(bytes, { status: range.partial ? 206 : 200, headers: { ...privateHeaders,
        "Content-Type": audio.mimeType, "Content-Length": String(bytes.byteLength), "Accept-Ranges": "bytes", "Content-Disposition": `inline; filename="recording.${audio.extension}"`,
        ...(range.partial ? { "Content-Range": `bytes ${range.start}-${range.end}/${audio.bytes.byteLength}` } : {}),
      } });
    } finally { audio.bytes.fill(0); }
  } catch (error) { return callError(error instanceof MediaError ? new Ask865AccessError(503, "Recording playback is temporarily unavailable.") : error); }
}
