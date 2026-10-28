import type { NextRequest } from "next/server";
import { z } from "zod";
import { Ask865AccessError } from "@/lib/ask865/access";
import { matchesAsk865Organization } from "@/lib/ask865/accessRules";
import { getCallAccess } from "@/lib/ask865/calls/access";
import { callDb, loadCallSettings } from "@/lib/ask865/calls/store";
import { callError } from "@/lib/ask865/calls/http";
import { recordingForPlayback, logRecordingAccess } from "@/lib/ask865/calls/jobs";
import { PrivateDriveArchive, driveEnvironment } from "@/lib/ask865/calls/drive";
import { MediaError } from "@/lib/ask865/calls/media";
import { RingCentralClient, ringCentralConfig, RingCentralError } from "@/lib/ask865/calls/ringcentral";
import { playbackSource, playbackResponse } from "@/lib/ask865/calls/playback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getCallAccess();
    if (!access.canPlayRecording) throw new Ask865AccessError(403, "Only management and admins can play recordings.");
    if (!matchesAsk865Organization(access.organizationId, request.nextUrl.searchParams.get("organization"))) throw new Ask865AccessError(409, "Your dealership changed. Reload the page.");
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new Ask865AccessError(403, "Open recordings from Atlas.");
    const id = (await context.params).id;
    if (!z.uuid().safeParse(id).success) throw new Ask865AccessError(400, "Invalid call.");
    const result = await callDb().from("ask865_call_reviews").select("provider_call_id,category,consent_reference,recording_id,expires_at,evaluation").eq("organization_id", access.organizationId).eq("id", id).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (result.error) throw new Error("Recording lookup failed");
    if (!result.data) throw new Ask865AccessError(404, "Recording unavailable.");
    const settings = await loadCallSettings(access.organizationId);
    if (!settings.provider_account_id || !settings.policy_version || process.env.ASK865_CALLS_PLAYBACK_ENABLED !== "true" || access.organizationId !== process.env.ASK865_CALLS_ORGANIZATION_ID) throw new Ask865AccessError(503, "Recording playback is disabled.");
    const recording = await recordingForPlayback(access.organizationId, result.data.provider_call_id, settings.provider_account_id);
    const source = playbackSource(result.data, recording);
    if (!recording || !source) throw new Ask865AccessError(404, "Recording is unavailable for this review.");
    const account = settings.provider_account_id;
    return await playbackResponse(request.headers.get("range"), {
      audit: () => logRecordingAccess(access.organizationId, recording.jobId, access.actorId),
      download: async () => {
        if (source === "archive") return new PrivateDriveArchive(driveEnvironment(process.env)).download(recording.receipt!,
          { organizationId: access.organizationId, accountId: account, recordingId: recording.recordingId });
        const config = ringCentralConfig(process.env);
        if (config.accountId !== account) throw new MediaError("account_mismatch");
        return new RingCentralClient(config).downloadRecording(recording.recordingId);
      },
    });
  } catch (error) { return callError(error instanceof MediaError || error instanceof RingCentralError
    ? new Ask865AccessError(503, "Recording unavailable. It may have expired at the recording source. Please try again later.") : error); }
}
