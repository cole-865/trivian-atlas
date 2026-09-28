import type { NextRequest } from "next/server";
import { getAsk865Access, Ask865AccessError } from "@/lib/ask865/access";
import { matchesAsk865Organization } from "@/lib/ask865/accessRules";
import { parseDashboardFilters } from "@/lib/ask865/filters";
import { loadDashboard } from "@/lib/ask865/data";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const access = await getAsk865Access();
    if (!matchesAsk865Organization(access.organizationId,request.nextUrl.searchParams.get("organization"))) {
      throw new Ask865AccessError(409,"Your selected dealership changed. Reload Ask 865.");
    }
    return Response.json(await loadDashboard(access.organizationId,parseDashboardFilters(request.nextUrl.searchParams)), { headers });
  } catch(error) {
    if(error instanceof Ask865AccessError) return Response.json({error:error.message},{status:error.status,headers});
    if(error instanceof Error && ["INVALID_DATE","INVALID_RANGE"].includes(error.message)) {
      return Response.json({error:"Choose a valid date range of ten years or less."},{status:400,headers});
    }
    console.error("Ask 865 reporting request failed");
    return Response.json({error:"Reporting data could not be loaded. Try again."},{status:503,headers});
  }
}
