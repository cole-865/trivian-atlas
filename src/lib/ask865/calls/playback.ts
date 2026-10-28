import { isEligible, isExcluded, type Category, type Evaluation } from "./domain.ts";
import { audioByteRange, type PrivateAudio } from "./media.ts";

export type PlaybackCall = { category: Category; consent_reference: string | null; recording_id: string | null; expires_at: string; evaluation: Evaluation };
export type PlaybackJob = { jobId: string; recordingId: string; receipt: { fileId: string; md5: string; bytes: number } | null; expiresAt: string | null };
export function playbackSource(call: PlaybackCall, job: PlaybackJob | null, now = Date.now()): "archive" | "provider" | null {
  if (!job || !call.consent_reference?.trim() || !(Date.parse(call.expires_at) > now) ||
      call.recording_id !== job.recordingId || isExcluded(call.category)) return null;
  if (isEligible(call.category) && job.receipt && job.expiresAt && Date.parse(job.expiresAt) > now) return "archive";
  // Customer calls held for pilot calibration still need human listening before
  // quality approval. This neither creates an archive nor authorizes a grade.
  if (isEligible(call.category) && !job.receipt && call.evaluation.state === "manual_review") return "provider";
  // Human privacy review is separate from AI approval. Never persist this audio,
  // clear the hold, or infer permission from a client-provided recording ID.
  if (call.evaluation.state === "not_evaluable" && call.evaluation.reasons.includes("privacy_review_required")) return "provider";
  return null;
}

export async function playbackResponse(rangeHeader: string | null, ports: { audit: () => Promise<void>; download: () => Promise<PrivateAudio> }) {
  // Fail closed before retrieving or releasing audio if the append-only audit fails.
  await ports.audit();
  const audio = await ports.download();
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
  try {
    let range;
    try { range = audioByteRange(rangeHeader, audio.bytes.byteLength); }
    catch { return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${audio.bytes.byteLength}` } }); }
    const bytes = new Uint8Array(audio.bytes.slice(range.start, range.end + 1));
    return new Response(bytes, { status: range.partial ? 206 : 200, headers: { ...headers,
      "Content-Type": audio.mimeType, "Content-Length": String(bytes.byteLength), "Accept-Ranges": "bytes", "Content-Disposition": `inline; filename="recording.${audio.extension}"`,
      ...(range.partial ? { "Content-Range": `bytes ${range.start}-${range.end}/${audio.bytes.byteLength}` } : {}),
    } });
  } finally { audio.bytes.fill(0); }
}
