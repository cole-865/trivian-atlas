import { timingSafeEqual } from "node:crypto";
import { Ask865AccessError } from "../access";

export const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export function validIngestToken(authorization: string | null, secret: string | undefined) {
  if (!secret || secret.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(authorization.slice(7)), expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function boundedJson(request: Request, limit: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Ask865AccessError(415, "Send JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new Ask865AccessError(400, "Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Ask865AccessError(413, "Request is too large."); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

export function callError(error: unknown) {
  if (error instanceof Ask865AccessError) return Response.json({ error: error.message }, { status: error.status, headers: privateHeaders });
  if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON." }, { status: 400, headers: privateHeaders });
  return Response.json({ error: "Call review is unavailable. No successful save is confirmed." }, { status: 503, headers: privateHeaders });
}
