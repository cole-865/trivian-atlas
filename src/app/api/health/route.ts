import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await supabaseServer();

  const { data, error } = await supabase.from("deals").select("id").limit(1);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return NextResponse.json({
    ok: !error,
    db: error ? error.message : "connected",
    sampleDealCount: data?.length ?? 0,
    user: user ? { id: user.id, email: user.email } : null,
  });
}