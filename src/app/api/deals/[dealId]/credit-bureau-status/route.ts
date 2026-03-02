import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("credit_report_jobs")
    .select("status, error_message, created_at")
    .eq("deal_id", dealId)
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