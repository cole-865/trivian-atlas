// services/credit-worker/src/underwriteDeal.ts

import { createClient } from "@supabase/supabase-js";
import {
  scoreDealTier,
  type ScoreDealTierArgs,
  type UnderwritingTier,
} from "./underwriting/scoreDealTier.js";

type Tier = UnderwritingTier;

type UnderwriteArgs = {
  incomeMonthly: number;
  score: number | null;
  repoCount: number;
  monthsSinceRepo: number | null;
  paidAutoTrades: number;
  openAutoTrades: number;
  residenceMonths: number | null;
  jobMonths: number | null;
  cashDown: number;
  vehiclePrice: number;
};

type UnderwriteResult = {
  decision: "approved" | "denied";
  tier: Tier | null;
  scoreTotal: number;
  hardStop: boolean;
  hardStopReason: string | null;
  maxTermMonths: number | null;
  minCashDown: number | null;
  minDownPct: number | null;
  maxPti: number | null;
  maxAmountFinanced: number | null;
  maxVehiclePrice: number | null;
  maxLtv: number | null;
  apr: number | null;
  scoreFactors: Array<{
    code: string;
    points: number;
    note: string;
  }>;
  notes: string;
};

type TierPolicyRow = {
  tier: string;
  max_vehicle_price: string | number;
  max_amount_financed: string | number;
  max_ltv: string | number;
  max_term_months: number;
  max_pti: string | number;
  min_cash_down: string | number;
  min_down_pct: string | number;
  apr: string | number | null;
  active: boolean;
  sort_order: number;
  updated_at?: string;
};

function monthsBetween(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;

  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12;
  months += now.getMonth() - d.getMonth();
  if (now.getDate() < d.getDate()) months -= 1;
  return Math.max(0, months);
}

function toNumber(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTier(value: string): Tier {
  const tier = String(value || "").trim().toUpperCase();
  if (tier === "A" || tier === "B" || tier === "C" || tier === "D" || tier === "BHPH") {
    return tier;
  }
  throw new Error(`Unsupported tier from underwriting_tier_policy: ${value}`);
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!url) {
    throw new Error("Missing SUPABASE_URL in credit-worker environment");
  }

  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) in credit-worker environment"
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadTierPolicy(tier: Tier) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("underwriting_tier_policy")
    .select(
      `
      tier,
      max_vehicle_price,
      max_amount_financed,
      max_ltv,
      max_term_months,
      max_pti,
      min_cash_down,
      min_down_pct,
      apr,
      active,
      sort_order,
      updated_at
    `
    )
    .eq("tier", tier)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed loading underwriting_tier_policy for ${tier}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`No active underwriting_tier_policy row found for tier ${tier}`);
  }

  const row = data as TierPolicyRow;

  return {
    tier: normalizeTier(row.tier),
    maxTermMonths: Number(row.max_term_months || 0),
    minCashDown: toNumber(row.min_cash_down),
    minDownPct: toNumber(row.min_down_pct),
    maxPti: toNumber(row.max_pti),
    maxAmountFinanced: toNumber(row.max_amount_financed),
    maxVehiclePrice: toNumber(row.max_vehicle_price),
    maxLtv: toNumber(row.max_ltv),
    apr: toNumber(row.apr, 28.99),
  };
}

export function calcJobMonthsFromHireDate(hireDate: string | null | undefined): number | null {
  return monthsBetween(hireDate);
}

export async function underwriteDealTier(args: ScoreDealTierArgs): Promise<UnderwriteResult> {
  const scored = scoreDealTier(args);

  if (scored.hardStop || !scored.tier) {
    return {
      decision: scored.decision,
      tier: scored.tier,
      scoreTotal: scored.scoreTotal,
      hardStop: scored.hardStop,
      hardStopReason: scored.hardStopReason,
      maxTermMonths: null,
      minCashDown: null,
      minDownPct: null,
      maxPti: null,
      maxAmountFinanced: null,
      maxVehiclePrice: null,
      maxLtv: null,
      apr: null,
      scoreFactors: scored.scoreFactors,
      notes: scored.notes,
    };
  }

  const tierRule = await loadTierPolicy(scored.tier);

  return {
    decision: scored.decision,
    tier: scored.tier,
    scoreTotal: scored.scoreTotal,
    hardStop: scored.hardStop,
    hardStopReason: scored.hardStopReason,
    maxTermMonths: tierRule.maxTermMonths,
    minCashDown: tierRule.minCashDown,
    minDownPct: tierRule.minDownPct,
    maxPti: tierRule.maxPti,
    maxAmountFinanced: tierRule.maxAmountFinanced,
    maxVehiclePrice: tierRule.maxVehiclePrice,
    maxLtv: tierRule.maxLtv,
    apr: tierRule.apr,
    scoreFactors: scored.scoreFactors,
    notes: scored.notes,
  };
}

export async function underwriteDeal(args: UnderwriteArgs): Promise<UnderwriteResult> {
  // Hard stops
  if (args.incomeMonthly > 0 && args.incomeMonthly < 2000) {
    return {
      decision: "denied",
      tier: null,
      scoreTotal: 0,
      hardStop: true,
      hardStopReason: "Income under $2,000/month",
      maxTermMonths: null,
      minCashDown: null,
      minDownPct: null,
      maxPti: null,
      maxAmountFinanced: null,
      maxVehiclePrice: null,
      maxLtv: null,
      apr: null,
      scoreFactors: [],
      notes: "Hard stop: income under minimum threshold.",
    };
  }

  return underwriteDealTier({
    primary: {
      score: args.score,
      repoCount: args.repoCount,
      monthsSinceRepo: args.monthsSinceRepo,
      paidAutoTrades: args.paidAutoTrades,
      openAutoTrades: args.openAutoTrades,
      residenceMonths: args.residenceMonths,
    },
  });
}
