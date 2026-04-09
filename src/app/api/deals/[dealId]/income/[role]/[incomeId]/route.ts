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
const ALLOWED_INCOME_TYPES = new Set(["w2", "self_employed", "fixed", "cash"]);
const ALLOWED_PAY_FREQUENCIES = new Set(["weekly", "biweekly", "semimonthly", "monthly", "annually"]);

type JsonMap = Record<string, unknown>;
type SupabaseLike = object;
type IncomeType = "w2" | "self_employed" | "fixed" | "cash";
type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "annually";

type IncomeProfileRow = {
  id: string;
  deal_person_id: string;
  income_type: IncomeType;
  applied_to_deal: boolean;
  monthly_gross_manual: number | null;
  monthly_gross_calculated: number | null;
  manual_notes: string | null;
  hire_date: string | null;
  pay_frequency: PayFrequency | null;
  gross_per_pay: number | null;
  gross_ytd: number | null;
  pay_date: string | null;
  pay_period_end: string | null;
  ytd_start_date: string | null;
  ytd_end_date: string | null;
  calc_flags: JsonMap;
  created_at: string;
  updated_at: string;
};

type IncomePatch = Partial<
  Omit<IncomeProfileRow, "id" | "deal_person_id" | "created_at" | "updated_at">
>;

type IncomePatchBody = {
  income_type?: unknown;
  applied_to_deal?: unknown;
  monthly_gross_manual?: unknown;
  monthly_gross_calculated?: unknown;
  gross_per_pay?: unknown;
  gross_ytd?: unknown;
  hire_date?: unknown;
  pay_period_end?: unknown;
  pay_date?: unknown;
  ytd_start_date?: unknown;
  ytd_end_date?: unknown;
  pay_frequency?: unknown;
  manual_notes?: unknown;
  calc_flags?: unknown;
};

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

function asIncomeType(v: unknown): IncomeType | null {
  const s = String(v ?? "").toLowerCase();
  return ALLOWED_INCOME_TYPES.has(s) ? (s as IncomeType) : null;
}

function asPayFrequency(v: unknown): PayFrequency | null {
  const s = String(v ?? "").toLowerCase();
  return ALLOWED_PAY_FREQUENCIES.has(s) ? (s as PayFrequency) : null;
}

function numOrNull(v: unknown): number | null {
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

function dateOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  // accept YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // if they send an ISO, try to coerce
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeIncome(row: IncomeProfileRow | null) {
  if (!row) return row;
  return {
    ...row,
    monthly_gross_manual: numOrNull(row.monthly_gross_manual),
    monthly_gross_calculated: numOrNull(row.monthly_gross_calculated),
    gross_per_pay: numOrNull(row.gross_per_pay),
    gross_ytd: numOrNull(row.gross_ytd),
  };
}

async function getPersonIdForRole(supabase: SupabaseLike, dealId: string, role: string) {
  const personResult = await getDealPersonForCurrentOrganization<{ id: string }>(
    supabase,
    dealId,
    role,
    "id"
  );

  if (personResult.error) {
    return {
      error: NextResponse.json(
        { error: "Failed to load deal_people", details: personResult.error.message },
        { status: 500 }
      ),
    };
  }

  if (!personResult.data?.id) {
    return { error: NextResponse.json({ error: "Person not found for role" }, { status: 404 }) };
  }

  return { personId: personResult.data.id as string };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ dealId: string; role: string; incomeId: string }> }
) {
  const { dealId, role, incomeId } = await params;

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

  const personRes = await getPersonIdForRole(supabase, dealId, role);
  if ("error" in personRes) return personRes.error;
  const personId = personRes.personId;

  let body: IncomePatchBody = {};
  try {
    body = (await req.json()) as IncomePatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: IncomePatch = {};

  // income_type
  if (body.income_type !== undefined) {
    const t = asIncomeType(body.income_type);
    if (!t) return NextResponse.json({ error: "Invalid income_type" }, { status: 400 });
    patch.income_type = t;
  }

  // applied_to_deal
  if (body.applied_to_deal !== undefined) patch.applied_to_deal = !!body.applied_to_deal;

  // money fields
  if (body.monthly_gross_manual !== undefined) patch.monthly_gross_manual = numOrNull(body.monthly_gross_manual);
  if (body.monthly_gross_calculated !== undefined) patch.monthly_gross_calculated = numOrNull(body.monthly_gross_calculated);
  if (body.gross_per_pay !== undefined) patch.gross_per_pay = numOrNull(body.gross_per_pay);
  if (body.gross_ytd !== undefined) patch.gross_ytd = numOrNull(body.gross_ytd);

  // dates
  if (body.hire_date !== undefined) patch.hire_date = dateOrNull(body.hire_date);
  if (body.pay_period_end !== undefined) patch.pay_period_end = dateOrNull(body.pay_period_end);
  if (body.pay_date !== undefined) patch.pay_date = dateOrNull(body.pay_date);
  if (body.ytd_start_date !== undefined) patch.ytd_start_date = dateOrNull(body.ytd_start_date);
  if (body.ytd_end_date !== undefined) patch.ytd_end_date = dateOrNull(body.ytd_end_date);

  // enums
  if (body.pay_frequency !== undefined) {
    const f = body.pay_frequency === null ? null : asPayFrequency(body.pay_frequency);
    if (body.pay_frequency !== null && !f) {
      return NextResponse.json({ error: "Invalid pay_frequency" }, { status: 400 });
    }
    patch.pay_frequency = f;
  }

  // notes + flags
  if (body.manual_notes !== undefined) {
    patch.manual_notes = body.manual_notes === "" ? null : String(body.manual_notes ?? "");
  }

  if (body.calc_flags !== undefined) {
    // allow null? your column is NOT NULL, so convert null to {}
    if (body.calc_flags === null) patch.calc_flags = {};
    else if (typeof body.calc_flags === "object" && body.calc_flags) {
      patch.calc_flags = body.calc_flags as JsonMap;
    }
    else patch.calc_flags = {};
  }

  // if nothing to update, return current row
  if (Object.keys(patch).length === 0) {
    const { data, error } = await scopeQueryToOrganization(
      supabase.from("income_profiles").select(SELECT_FIELDS),
      scopedDeal.organizationId
    )
      .eq("id", incomeId)
      .eq("deal_person_id", personId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Failed to load income", details: error.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      income: normalizeIncome(data as unknown as IncomeProfileRow | null),
    });
  }

  const { data, error } = await supabase
    .from("income_profiles")
    .update(patch)
    .eq("organization_id", scopedDeal.organizationId)
    .eq("id", incomeId)
    .eq("deal_person_id", personId)
    .select(SELECT_FIELDS)
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to update income", details: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    income: normalizeIncome(data as unknown as IncomeProfileRow | null),
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ dealId: string; role: string; incomeId: string }> }
) {
  const { dealId, role, incomeId } = await params;

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

  const personRes = await getPersonIdForRole(supabase, dealId, role);
  if ("error" in personRes) return personRes.error;
  const personId = personRes.personId;

  const { error } = await supabase
    .from("income_profiles")
    .delete()
    .eq("organization_id", scopedDeal.organizationId)
    .eq("id", incomeId)
    .eq("deal_person_id", personId);

  if (error) {
    return NextResponse.json({ error: "Failed to delete income", details: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
