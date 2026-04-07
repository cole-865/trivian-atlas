import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  assertDealInCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { scopeDealChildQueryToOrganization } from "@/lib/deals/underwritingOrganizationScope";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();
  const scopedDeal = await assertDealInCurrentOrganization(supabase, dealId);

  if (!scopedDeal.organizationId) {
    return NextResponse.json(
      { error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

  if (scopedDeal.error) {
    return NextResponse.json(
      { error: "Failed to load deal", details: scopedDeal.error.message },
      { status: 500 }
    );
  }

  if (!scopedDeal.data) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const { data, error } = await scopeDealChildQueryToOrganization(
    supabase
      .from("credit_report_jobs")
      .select("status, error_message, created_at"),
    scopedDeal.organizationId,
    dealId
  )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to load status", details: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    status: data?.status ?? null,
    error_message: data?.error_message ?? null,
    created_at: data?.created_at ?? null,
  });
}
