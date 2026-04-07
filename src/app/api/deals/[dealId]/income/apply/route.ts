import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";

function round2(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return Math.round(v * 100) / 100;
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickMonthly(row: Record<string, unknown>): number {
  const calc = row?.monthly_gross_calculated;
  const manual = row?.monthly_gross_manual;

  const calcNum = num(calc);
  const manualNum = num(manual);

  const val = calcNum > 0 ? calcNum : manualNum > 0 ? manualNum : 0;
  return round2(val);
}

function sumApplied(rows: Array<Record<string, unknown>>) {
  return round2(
    (rows || [])
      .filter((r) => r?.applied_to_deal === true)
      .reduce((sum, r) => sum + pickMonthly(r), 0)
  );
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  // 0) Load deal (we need household_income)
  const { data: deal, error: dealErr, organizationId } =
    await getDealForCurrentOrganization<{
      id: string;
      household_income: boolean | null;
    }>(supabase, dealId, "id, household_income");

  if (!organizationId) {
    return NextResponse.json(
      { error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

  if (dealErr) {
    return NextResponse.json(
      { error: "Failed to load deal", details: dealErr.message },
      { status: 500 }
    );
  }

  const householdIncome = !!deal?.household_income;

  // 1) Load deal people (primary + optional co)
  const { data: people, error: peopleErr } = await scopeQueryToOrganization(
    supabase.from("deal_people").select("id, role"),
    organizationId
  )
    .eq("deal_id", dealId);

  if (peopleErr) {
    return NextResponse.json(
      { error: "Failed to load deal_people", details: peopleErr.message },
      { status: 500 }
    );
  }

  const primary = (people ?? []).find((p) => p.role === "primary");
  const co = (people ?? []).find((p) => p.role === "co");

  if (!primary) {
    return NextResponse.json(
      { error: "Primary person missing (deal_people.role = 'primary')" },
      { status: 400 }
    );
  }

  // 2) Load income profiles for those people (multiple rows per person)
  const personIds = [primary.id, co?.id].filter(Boolean) as string[];

  const { data: incomes, error: incErr } = await scopeQueryToOrganization(
    supabase
      .from("income_profiles")
      .select(
        "id, deal_person_id, income_type, applied_to_deal, monthly_gross_calculated, monthly_gross_manual"
      ),
    organizationId
  )
    .in("deal_person_id", personIds);

  if (incErr) {
    return NextResponse.json(
      { error: "Failed to load income_profiles", details: incErr.message },
      { status: 500 }
    );
  }

  const primaryRows = (incomes ?? []).filter((r) => r.deal_person_id === primary.id);
  const coRows = co ? (incomes ?? []).filter((r) => r.deal_person_id === co.id) : [];

  // 3) Totals
  const primaryApplied = sumApplied(primaryRows);
  const coApplied = householdIncome ? sumApplied(coRows) : 0;
  const grossMonthlyIncome = round2(primaryApplied + coApplied);

  // Included detail (useful for UI/debug)
  const included = [
    ...(primaryRows || [])
      .filter((r) => r.applied_to_deal === true)
      .map((r) => ({
        role: "primary" as const,
        income_id: r.id,
        income_type: r.income_type ?? null,
        monthly: pickMonthly(r),
      })),
    ...(householdIncome
      ? (coRows || [])
          .filter((r) => r.applied_to_deal === true)
          .map((r) => ({
            role: "co" as const,
            income_id: r.id,
            income_type: r.income_type ?? null,
            monthly: pickMonthly(r),
          }))
      : []),
  ];

  // 4) Load config (payment cap pct). Default to 0.22 if missing.
  const { data: cfg, error: cfgErr } = await supabase
    .from("trivian_config")
    .select("payment_cap_pct")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cfgErr) {
    return NextResponse.json(
      { error: "Failed to load trivian_config", details: cfgErr.message },
      { status: 500 }
    );
  }

  const capPctRaw = num(cfg?.payment_cap_pct);
  const capPct = capPctRaw > 0 ? capPctRaw : 0.22;

  const maxPayment = round2(grossMonthlyIncome * capPct);

  // 5) Upsert underwriting_inputs
  const nowIso = new Date().toISOString();

  const uwPayload: Record<string, unknown> = {
    deal_id: dealId,
    gross_monthly_income: grossMonthlyIncome,
    other_monthly_income: 0,
    max_payment_pct: capPct,
    updated_at: nowIso,
  };

  const { data: existing, error: existingErr } = await supabase
    .from("underwriting_inputs")
    .select("id")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (existingErr) {
    return NextResponse.json(
      { error: "Failed to check underwriting_inputs", details: existingErr.message },
      { status: 500 }
    );
  }

  let saved: Record<string, unknown> | null = null;

  if (existing?.id) {
    const { data, error } = await supabase
      .from("underwriting_inputs")
      .update(uwPayload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to update underwriting_inputs", details: error.message },
        { status: 500 }
      );
    }
    saved = data;
  } else {
    const { data, error } = await supabase
      .from("underwriting_inputs")
      .insert(uwPayload)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to insert underwriting_inputs", details: error.message },
        { status: 500 }
      );
    }
    saved = data;
  }

  return NextResponse.json({
    ok: true,
    deal_id: dealId,
    household_income: householdIncome,
    included,
    totals: {
      primary_applied: primaryApplied,
      co_applied: coApplied,
      gross_monthly_income: grossMonthlyIncome,
      max_payment_pct: capPct,
      max_payment: maxPayment,
    },
    underwriting_inputs: saved,
  });
}
