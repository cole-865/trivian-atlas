import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { loadPrimaryCustomerNames } from "@/lib/deals/customerName";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;

  if (!dealId) {
    return NextResponse.json({ error: "Missing dealId" }, { status: 400 });
  }

  const supabase = await supabaseServer();

  // 1) Deal
  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .single();

  if (dealErr || !deal) {
    return NextResponse.json(
      { error: "Deal not found", details: dealErr?.message },
      { status: 404 }
    );
  }

  const primaryNames = await loadPrimaryCustomerNames(supabase, [dealId]);
  const displayCustomerName = primaryNames[dealId] ?? deal.customer_name ?? null;

  // 2) People
  const { data: people, error: peopleErr } = await supabase
    .from("deal_people")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  if (peopleErr) {
    return NextResponse.json(
      { error: "Failed to load people", details: peopleErr.message },
      { status: 500 }
    );
  }

  const personIds = (people ?? []).map((p) => p.id);

  // 3) Income
  const { data: income_profiles, error: incomeErr } = await supabase
    .from("income_profiles")
    .select("*")
    .in(
      "deal_person_id",
      personIds.length
        ? personIds
        : ["00000000-0000-0000-0000-000000000000"]
    );

  if (incomeErr) {
    return NextResponse.json(
      { error: "Failed to load income profiles", details: incomeErr.message },
      { status: 500 }
    );
  }

  // 4) Documents
  const { data: documents, error: docsErr } = await supabase
    .from("deal_documents")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (docsErr) {
    return NextResponse.json(
      { error: "Failed to load documents", details: docsErr.message },
      { status: 500 }
    );
  }

  // 5) Vehicle options are now derived from the saved structure snapshot.
  const { data: dealStructure, error: voErr } = await supabase
    .from("deal_structure")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (voErr) {
    return NextResponse.json(
      { error: "Failed to load deal structure", details: voErr.message },
      { status: 500 }
    );
  }

  // 6) Vehicle selection
  const { data: vehicle_selection, error: vsErr } = await supabase
    .from("deal_vehicle_selection")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (vsErr) {
    return NextResponse.json(
      { error: "Failed to load vehicle selection", details: vsErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    deal: {
      ...deal,
      customer_name: displayCustomerName,
    },
    people: people ?? [],
    income_profiles: income_profiles ?? [],
    documents: documents ?? [],
    vehicle_options: dealStructure ? [dealStructure] : [],
    vehicle_selection: vehicle_selection ?? null,
    deal_structure: dealStructure ?? null,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;

  if (!dealId) {
    return NextResponse.json({ error: "Missing dealId" }, { status: 400 });
  }

  const body = await req.json();
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("deals")
    .update({
      cash_down: body.cash_down,
      trade_value: body.trade_value,
      trade_payoff: body.trade_payoff,
      has_trade: body.has_trade,
      updated_at: new Date().toISOString(),
    })
    .eq("id", dealId)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to update deal", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, deal: data });
}
