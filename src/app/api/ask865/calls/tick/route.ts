import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { Ask865AccessError } from "@/lib/ask865/access";
import { callError, privateHeaders, validIngestToken } from "@/lib/ask865/calls/http";
import { discoverWithCheckpoint, discoveryPlan } from "@/lib/ask865/calls/scheduler";
import { MediaError } from "@/lib/ask865/calls/media";
import { POST as recordings } from "../recordings/route";
export const runtime = "nodejs";
export const maxDuration = 600;
type State = { organization_id: string; provider_account_id: string; cursor_at: string; lease_token: string; lease_until: string; last_error: string | null; last_success_at: string | null };
type ScheduleDatabase = { public: { Tables: Record<never,never>; Views: Record<never,never>; Enums: Record<never,never>; CompositeTypes: Record<never,never>; Functions: {
  atlas_ask865_claim_discovery: { Args: {p_org:string;p_account:string;p_start:string}; Returns: State[] };
  atlas_ask865_finish_discovery: {Args: {p_org:string;p_account:string;p_token:string;p_cursor:string;p_error:string|null}; Returns:boolean};
} } };
export async function POST(request: Request) {
  let lease: State | undefined;
  const db = createAdminClient() as unknown as SupabaseClient<ScheduleDatabase>;
  try {
    const authorization = request.headers.get("authorization");
    if (!validIngestToken(authorization,process.env.ASK865_CALLS_INGEST_TOKEN)) throw new Ask865AccessError(401,"Unauthorized importer.");
    if (process.env.ASK865_CALLS_SCHEDULER_ENABLED !== "true" || process.env.ASK865_CALLS_ENABLED !== "true" || process.env.ASK865_CALLS_RECORDINGS_ENABLED !== "true" || process.env.ASK865_CALLS_CONSENT_APPROVED !== "true") throw new Ask865AccessError(503,"Automatic call processing is disabled.");
    const org=z.uuid().parse(process.env.ASK865_CALLS_ORGANIZATION_ID),account=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).parse(process.env.ASK865_RINGCENTRAL_ACCOUNT_ID);
    const start=z.iso.datetime({offset:true}).parse(process.env.ASK865_CALLS_CONSENT_FROM),through=z.iso.datetime({offset:true}).parse(process.env.ASK865_CALLS_CONSENT_THROUGH);
    if(Date.now()>=Date.parse(through)) throw new MediaError("consent_review_required");
    const claim=await db.rpc("atlas_ask865_claim_discovery",{p_org:org,p_account:account,p_start:start});
    if(claim.error) throw new MediaError("discovery_unavailable"); lease=claim.data?.[0];
    if(!lease) return Response.json({status:"busy"},{headers:privateHeaders});
    const active=lease;
    const plan=discoveryPlan(active.cursor_at,start,through);
    const invoke = (payload: object) => recordings(new Request("http://localhost/api/ask865/calls/recordings",{method:"POST",headers:{authorization:authorization!,"content-type":"application/json"},body:JSON.stringify(payload)}));
    await discoverWithCheckpoint(plan,async window=>{
      const response=await invoke({action:"discover",...window});
      if(!response.ok) throw new MediaError("discovery_incomplete");
    },async cursor=>{
      const result=await db.rpc("atlas_ask865_finish_discovery",{p_org:org,p_account:account,p_token:active.lease_token,p_cursor:cursor,p_error:null});
      if(result.error||!result.data)throw new MediaError("discovery_lease_lost");
    });
    lease=undefined;
    // One job per tick bounds cost and execution time. Job leases prevent duplicate workers.
    const processed=await invoke({action:"process_one"});
    return Response.json({status:processed.ok?"completed":"processing_needs_attention",discoveryWindows:plan.windows.length,processing:await processed.json()},{status:processed.ok?200:503,headers:privateHeaders});
  } catch(error) {
    if(lease) await db.rpc("atlas_ask865_finish_discovery",{p_org:lease.organization_id,p_account:lease.provider_account_id,p_token:lease.lease_token,p_cursor:lease.cursor_at,p_error:error instanceof MediaError?error.code:"discovery_failed"});
    return callError(error);
  }
}
