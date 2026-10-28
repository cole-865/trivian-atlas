import { z } from "zod";
import { Ask865AccessError } from "@/lib/ask865/access";
import { callDb } from "@/lib/ask865/calls/store";
import { callError, privateHeaders, validIngestToken } from "@/lib/ask865/calls/http";

// Invoke daily from the trusted importer. Database cascade removes associated
// review audit rows at the same retention boundary. No recording is stored here.
export async function POST(request: Request) {
  try {
    if (!validIngestToken(request.headers.get("authorization"), process.env.ASK865_CALLS_INGEST_TOKEN)) throw new Ask865AccessError(401, "Unauthorized importer.");
    const org = process.env.ASK865_CALLS_ORGANIZATION_ID;
    if (!z.uuid().safeParse(org).success) throw new Ask865AccessError(503, "Importer organization is not configured.");
    const { count, error } = await callDb().from("ask865_call_reviews").delete({ count: "exact" })
      .eq("organization_id", org!).lte("expires_at", new Date().toISOString());
    if (error) throw new Error("Retention failed");
    return Response.json({ deleted: count }, { headers: privateHeaders });
  } catch (error) { return callError(error); }
}
