import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { loadPrimaryCustomerNames } from "@/lib/deals/customerName";
import { canAccessStep } from "@/lib/deals/canAccessStep";
import {
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";

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
  const {
    data: deal,
    error: dealErr,
    organizationId,
  } = await getDealForCurrentOrganization<Record<string, unknown>>(
    supabase,
    dealId,
    "*"
  );

  if (!organizationId) {
    return NextResponse.json(
      { error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

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
  const scopedDeal = await getDealForCurrentOrganization(supabase, dealId, "id");

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

  const { data: underwritingResult, error: underwritingErr } = await supabase
    .from("underwriting_results")
    .select("decision")
    .eq("deal_id", dealId)
    .eq("stage", "bureau_precheck")
    .maybeSingle();

  if (underwritingErr) {
    return NextResponse.json(
      { error: "Failed to load underwriting result", details: underwritingErr.message },
      { status: 500 }
    );
  }

  const access = await canAccessStep({
    supabase,
    step: "vehicle",
    deal: {},
    underwriting: {
      decision: underwritingResult?.decision ?? null,
    },
  });

  if (!access.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "STEP_BLOCKED",
        redirectTo: access.redirectTo ?? "income",
        reason: access.reason,
      },
      { status: 403 }
    );
  }

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
    .eq("organization_id", scopedDeal.organizationId)
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
