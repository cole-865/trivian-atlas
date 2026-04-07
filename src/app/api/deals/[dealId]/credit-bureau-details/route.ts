import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  assertDealInCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
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

  const [
    reportRes,
    summaryRes,
    tradelinesRes,
    publicRecordsRes,
    messagesRes,
  ] = await Promise.all([
    supabase
      .from("credit_reports")
      .select(
        "id, deal_id, latest_job_id, bureau, raw_bucket, raw_path, redacted_bucket, redacted_path, redacted_text, created_at, updated_at"
      )
      .eq("organization_id", scopedDeal.organizationId)
      .eq("deal_id", dealId)
      .maybeSingle(),

    supabase
      .from("bureau_summary")
      .select("*")
      .eq("organization_id", scopedDeal.organizationId)
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("bureau_tradelines")
      .select("*")
      .eq("organization_id", scopedDeal.organizationId)
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true }),

    supabase
      .from("bureau_public_records")
      .select("*")
      .eq("organization_id", scopedDeal.organizationId)
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true }),

    supabase
      .from("bureau_messages")
      .select("*")
      .eq("organization_id", scopedDeal.organizationId)
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true }),
  ]);

  const firstError =
    reportRes.error ||
    summaryRes.error ||
    tradelinesRes.error ||
    publicRecordsRes.error ||
    messagesRes.error;

  if (firstError) {
    return NextResponse.json(
      {
        error: "Failed to load bureau details",
        details: firstError.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    report: reportRes.data ?? null,
    summary: summaryRes.data ?? null,
    tradelines: tradelinesRes.data ?? [],
    publicRecords: publicRecordsRes.data ?? [],
    messages: messagesRes.data ?? [],
  });
}
