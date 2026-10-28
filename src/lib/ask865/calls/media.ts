// Server/worker only. Audio and raw text stay in memory, never in error messages.
export const maxAudioBytes = 24_000_000;
export type PrivateAudio = { bytes: Uint8Array; mimeType: "audio/mpeg" | "audio/wav"; extension: "mp3" | "wav" };
export class MediaError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Call media: ${code}`); this.name = "MediaError"; this.code = code; }
}
export async function limitedBytes(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) { await response.body?.cancel(); throw new MediaError("response_too_large"); }
  const reader = response.body?.getReader();
  if (!reader) throw new MediaError("empty_response");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { value.fill(0); await reader.cancel(); throw new MediaError("response_too_large"); }
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } finally { for (const chunk of chunks) chunk.fill(0); reader.releaseLock(); }
}
export async function limitedJson(response: Response, limit = 2_000_000): Promise<unknown> {
  const bytes = await limitedBytes(response, limit);
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new MediaError("invalid_response"); }
  finally { bytes.fill(0); }
}
export function inspectAudio(bytes: Uint8Array, contentType: string): PrivateAudio {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const header = Buffer.from(bytes.subarray(0, 12));
  if (!bytes.length || bytes.length > maxAudioBytes) throw new MediaError("audio_size_limit");
  if (["audio/wav", "audio/x-wav", "audio/wave"].includes(type) && header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WAVE")
    return { bytes, mimeType: "audio/wav", extension: "wav" };
  if (["audio/mpeg", "audio/mp3"].includes(type) && (header.toString("ascii", 0, 3) === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224)))
    return { bytes, mimeType: "audio/mpeg", extension: "mp3" };
  throw new MediaError("unsupported_audio");
}
export function audioByteRange(header: string | null, size: number) {
  if (header === null) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new MediaError("invalid_range");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || (!match[1] && Number(match[2]) <= 0)) throw new MediaError("invalid_range");
  return { start, end, partial: true };
}
