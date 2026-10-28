import { z } from "zod";
import { MediaError } from "./media";
import { validateTranscript, type RawTranscript } from "./transcription";

export const maxRecordingParts = 4;
export const recordingPartSchema = z.object({
  recordingId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  offsetSeconds: z.number().finite().nonnegative(), durationSeconds: z.number().finite().positive().max(14400),
}).strict();
export type RecordingPart = z.infer<typeof recordingPartSchema>;
export const recordingPartsSchema = z.array(recordingPartSchema).min(1).max(maxRecordingParts);
export const partArchivesSchema = z.array(z.object({
  recordingId: recordingPartSchema.shape.recordingId,
  fileId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  receipt: z.object({ fileId: z.string(), md5: z.string().regex(/^[a-f0-9]{32}$/), bytes: z.number().int().min(1).max(24000000) }).strict().nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
}).strict()).max(maxRecordingParts);
export type PartArchive = z.infer<typeof partArchivesSchema>[number];

export function orderedRecordingParts(ids: string[], parts: unknown, duration: number): RecordingPart[] {
  const parsed = recordingPartsSchema.safeParse(parts);
  if (!parsed.success || new Set(ids).size !== ids.length || parsed.data.length !== ids.length || !Number.isFinite(duration) || duration <= 0) throw new MediaError("recording_manifest_required");
  const sorted = [...parsed.data].sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  if (new Set(sorted.map(p => p.recordingId)).size !== ids.length || sorted.some((p, i) => !ids.includes(p.recordingId) || p.offsetSeconds + p.durationSeconds > duration + 1 || (i > 0 && p.offsetSeconds < sorted[i - 1].offsetSeconds + sorted[i - 1].durationSeconds))) throw new MediaError("recording_manifest_ambiguous");
  return sorted;
}

export function joinRecordingTranscripts(parts: RecordingPart[], transcripts: RawTranscript[], duration: number): RawTranscript {
  if (parts.length !== transcripts.length) throw new MediaError("recording_manifest_required");
  const segments = parts.flatMap((part, index) => validateTranscript(transcripts[index], part.durationSeconds).segments.map(s => ({
    ...s, speaker: `part${index + 1}:${s.speaker}`,
    start: part.offsetSeconds + s.start, end: part.offsetSeconds + s.end,
  })));
  // Separate diarization runs reuse A/B labels. Prefixing keeps them distinct;
  // timestamps retain actual transfer gaps, never fabricated words or silence.
  return validateTranscript({ segments }, duration);
}
