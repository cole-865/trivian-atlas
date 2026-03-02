import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;

  if (!dealId) {
    return NextResponse.json({ error: "Missing dealId" }, { status: 400 });
  }

  const supabase = await supabaseServer();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) {
    return NextResponse.json(
      { error: "Auth error", details: authErr.message },
      { status: 401 }
    );
  }
  if (!auth?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ✅ household_income=true means "include co-app income"
  const household_income = Boolean(body.household_income);

  const { data, error } = await supabase
    .from("deals")
    .update({ household_income })
    .eq("id", dealId)
    .select("id, household_income")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to update deals.household_income", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, deal: data });
}