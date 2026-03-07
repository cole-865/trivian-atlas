import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

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
      .eq("deal_id", dealId)
      .maybeSingle(),

    supabase
      .from("bureau_summary")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("bureau_tradelines")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true }),

    supabase
      .from("bureau_public_records")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true }),

    supabase
      .from("bureau_messages")
      .select("*")
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