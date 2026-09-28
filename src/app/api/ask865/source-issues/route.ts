import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAsk865Access, Ask865AccessError } from "@/lib/ask865/access";
import { matchesAsk865Organization } from "@/lib/ask865/accessRules";
import { parseSourceReview, isSameOriginReview } from "@/lib/ask865/review";

export async function PATCH(request: NextRequest) {
  const headers={"Cache-Control":"private, no-store"};
  try {
    if(!isSameOriginReview(request.headers.get("origin"),request.headers.get("host"))) throw new Ask865AccessError(403,"Invalid request origin.");
    const access=await getAsk865Access();
    if(!access.canReview) throw new Ask865AccessError(403,"You do not have permission to review source issues.");
    if(!matchesAsk865Organization(access.organizationId,request.nextUrl.searchParams.get("organization"))) {
      throw new Ask865AccessError(409,"Your selected dealership changed. Reload Ask 865.");
    }
    if(Number(request.headers.get("content-length") ?? 0)>16000) throw new Ask865AccessError(413,"Review is too large.");
    const body=parseSourceReview(await request.json());
    if(!body) throw new Ask865AccessError(400,"Invalid review.");
    const {data,error}=await createAdminClient().rpc("atlas_ask865_review",{
      p_organization_id:access.organizationId,p_report_key:body.reportKey,p_issue_code:body.issueCode,
      p_owner:body.owner,p_notes:body.notes,p_status:body.status,p_actor:access.actor,
    });
    if(error) throw new Error("Review failed");
    if(!data) throw new Ask865AccessError(404,"Issue not found.");
    return Response.json({status:"saved"},{headers});
  } catch(error) {
    if(error instanceof SyntaxError) return Response.json({error:"Invalid review."},{status:400,headers});
    if(error instanceof Ask865AccessError) return Response.json({error:error.message},{status:error.status,headers});
    console.error("Ask 865 source review failed");
    return Response.json({error:"Review could not be saved."},{status:503,headers});
  }
}
