import { z } from "zod";
import { inspectAudio, limitedJson, MediaError, type PrivateAudio } from "./media";

export const diarizationModel = "gpt-4o-transcribe-diarize";
export const diarizationShutdown = Date.parse("2027-02-26T00:00:00Z");
export const rawTranscriptSchema = z.object({ segments: z.array(z.object({
  speaker: z.string().min(1).max(80), start: z.number().finite().nonnegative(),
  end: z.number().finite().nonnegative(), text: z.string().trim().min(1).max(4000),
})).min(1).max(500) });
export type RawTranscript = z.infer<typeof rawTranscriptSchema>;

export function validateTranscript(raw: unknown, duration: number): RawTranscript {
  const result = rawTranscriptSchema.safeParse(raw);
  if (!result.success || !Number.isFinite(duration) || duration <= 0 || duration > 14400) throw new MediaError("invalid_transcript");
  let previous = -1;
  for (const segment of result.data.segments) {
    if (segment.start < previous || segment.end < segment.start || segment.end > duration + 1) throw new MediaError("invalid_transcript_timestamps");
    previous = segment.start;
  }
  return result.data;
}

export async function transcribeAudio(audio: PrivateAudio, duration: number, config: { apiKey: string; model: string }, send: typeof fetch = fetch, now = Date.now()) {
  if (!config.apiKey || config.model !== diarizationModel || now >= diarizationShutdown) throw new MediaError("transcriber_configuration_required");
  inspectAudio(audio.bytes, audio.mimeType);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 14400) throw new MediaError("invalid_duration");
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType }), `recording.${audio.extension}`);
  form.set("model", config.model); form.set("response_format", "diarized_json"); form.set("chunking_strategy", "auto");
  try {
    const response = await send("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${config.apiKey}` }, body: form,
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new MediaError(response.status === 429 ? "transcriber_rate_limited" : "transcription_failed"); }
    // A/B labels are not employee identity. This API provides no calibrated
    // confidence; callers must not turn successful transcription into 100%.
    return validateTranscript(await limitedJson(response), duration);
  } catch (error) { throw error instanceof MediaError ? error : new MediaError("transcription_failed"); }
}
