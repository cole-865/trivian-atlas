import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  assertDealInCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import {
  getDealPersonForCurrentOrganization,
  scopeQueryToOrganization,
} from "@/lib/deals/childOrganizationScope";

const ALLOWED_ROLES = new Set(["primary", "co"]);

function asIncomeType(v: any) {
  const s = String(v ?? "").toLowerCase();
  if (["w2", "self_employed", "fixed", "cash"].includes(s)) return s as any;
  return null;
}

function numOrNull(v: any) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeIncome(row: any) {
  if (!row) return row;
  return {
    ...row,
    // numerics
    monthly_gross_manual: numOrNull(row.monthly_gross_manual),
    monthly_gross_calculated: numOrNull(row.monthly_gross_calculated),
    gross_per_pay: numOrNull(row.gross_per_pay),
    gross_ytd: numOrNull(row.gross_ytd),
  };
}

const SELECT_FIELDS = [
  "id",
  "deal_person_id",
  "income_type",
  "applied_to_deal",
  "monthly_gross_manual",
  "monthly_gross_calculated",
  "manual_notes",
  "hire_date",
  "pay_frequency",
  "gross_per_pay",
  "gross_ytd",
  "pay_date",
  "pay_period_end",
  "ytd_start_date",
  "ytd_end_date",
  "calc_flags",
  "created_at",
  "updated_at",
].join(",");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string; role: string }> }
) {
  const { dealId, role } = await params;

  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

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

  // Find the deal_person for this role
  const personResult = await getDealPersonForCurrentOrganization<{ id: string }>(
    supabase,
    dealId,
    role,
    "id"
  );

  if (personResult.error) {
    return NextResponse.json(
      { error: "Failed to load deal_people", details: personResult.error.message },
      { status: 500 }
    );
  }

  if (!personResult.data?.id) {
    return NextResponse.json({ ok: true, incomes: [] }, { status: 200 });
  }

  const { data, error } = await scopeQueryToOrganization(
    supabase.from("income_profiles").select(SELECT_FIELDS),
    scopedDeal.organizationId
  )
    .eq("deal_person_id", personResult.data.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load incomes", details: error.message },
      { status: 500 }
    );
  }

  const normalized = (data ?? []).map(normalizeIncome);

  return NextResponse.json({ ok: true, incomes: normalized });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string; role: string }> }
) {
  const { dealId, role } = await params;

  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

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

  // Find the deal_person for this role
  const personResult = await getDealPersonForCurrentOrganization<{ id: string }>(
    supabase,
    dealId,
    role,
    "id"
  );

  if (personResult.error) {
    return NextResponse.json(
      { error: "Failed to load deal_people", details: personResult.error.message },
      { status: 500 }
    );
  }

  if (!personResult.data?.id) {
    return NextResponse.json({ error: "Person not found for role" }, { status: 404 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incomeType = asIncomeType(body?.income_type);
  if (!incomeType) {
    return NextResponse.json({ error: "Invalid income_type" }, { status: 400 });
  }

  const insertRow: any = {
    organization_id: scopedDeal.organizationId,
    deal_person_id: personResult.data.id,
    income_type: incomeType,
    applied_to_deal: true,

    monthly_gross_manual: null,
    monthly_gross_calculated: null,

    manual_notes: null,
    hire_date: null,

    pay_frequency: null,
    gross_per_pay: null,
    gross_ytd: null,

    pay_date: null,
    pay_period_end: null,

    ytd_start_date: null,
    ytd_end_date: null,

    calc_flags: {}, // NOT NULL
  };

  const { data, error } = await supabase
    .from("income_profiles")
    .insert(insertRow)
    .select(SELECT_FIELDS)
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to add income", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, income: normalizeIncome(data) });
}
