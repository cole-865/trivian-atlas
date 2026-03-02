import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  context: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await context.params;

  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("deal_people")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch deal people", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, dealId, people: data ?? [] });
}