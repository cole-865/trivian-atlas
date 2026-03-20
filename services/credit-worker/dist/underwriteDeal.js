// services/credit-worker/src/underwriteDeal.ts
import { createClient } from "@supabase/supabase-js";
const TIER_ORDER = ["BHPH", "D", "C", "B", "A"];
function clampTierIndex(idx) {
    return Math.max(0, Math.min(TIER_ORDER.length - 1, idx));
}
function moveTier(start, delta) {
    const startIdx = TIER_ORDER.indexOf(start);
    return TIER_ORDER[clampTierIndex(startIdx + delta)];
}
function roundHalfStep(value) {
    return Math.round(value * 2) / 2;
}
function monthsBetween(dateStr) {
    if (!dateStr)
        return null;
    const d = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(d.getTime()))
        return null;
    const now = new Date();
    let months = (now.getFullYear() - d.getFullYear()) * 12;
    months += now.getMonth() - d.getMonth();
    if (now.getDate() < d.getDate())
        months -= 1;
    return Math.max(0, months);
}
function toNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === "")
        return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function normalizeTier(value) {
    const tier = String(value || "").trim().toUpperCase();
    if (tier === "A" || tier === "B" || tier === "C" || tier === "D" || tier === "BHPH") {
        return tier;
    }
    throw new Error(`Unsupported tier from underwriting_tier_policy: ${value}`);
}
function getSupabaseAdmin() {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url) {
        throw new Error("Missing SUPABASE_URL in credit-worker environment");
    }
    if (!serviceRoleKey) {
        throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) in credit-worker environment");
    }
    return createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}
async function loadTierPolicy(tier) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from("underwriting_tier_policy")
        .select(`
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
    `)
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
    const row = data;
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
export function calcJobMonthsFromHireDate(hireDate) {
    return monthsBetween(hireDate);
}
export async function underwriteDeal(args) {
    const factors = [];
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
    if ((args.score ?? 999) < 420) {
        return {
            decision: "denied",
            tier: null,
            scoreTotal: 0,
            hardStop: true,
            hardStopReason: "Score below 420",
            maxTermMonths: null,
            minCashDown: null,
            minDownPct: null,
            maxPti: null,
            maxAmountFinanced: null,
            maxVehiclePrice: null,
            maxLtv: null,
            apr: null,
            scoreFactors: [],
            notes: "Hard stop: bureau score below minimum threshold.",
        };
    }
    if (args.repoCount > 1 && args.monthsSinceRepo !== null && args.monthsSinceRepo < 12) {
        return {
            decision: "denied",
            tier: null,
            scoreTotal: 0,
            hardStop: true,
            hardStopReason: "More than 1 repo within last 12 months",
            maxTermMonths: null,
            minCashDown: null,
            minDownPct: null,
            maxPti: null,
            maxAmountFinanced: null,
            maxVehiclePrice: null,
            maxLtv: null,
            apr: null,
            scoreFactors: [],
            notes: "Hard stop: excessive recent repos.",
        };
    }
    // Start at Tier C
    let movement = 0;
    // Paid autos
    if (args.paidAutoTrades >= 2) {
        movement += 1.5;
        factors.push({ code: "PAID_AUTOS_2_PLUS", points: 1.5, note: "2+ paid auto trades" });
    }
    else if (args.paidAutoTrades === 1) {
        movement += 1;
        factors.push({ code: "PAID_AUTOS_1", points: 1, note: "1 paid auto trade" });
    }
    // Open auto trades
    if (args.openAutoTrades === 0 && args.paidAutoTrades === 0) {
        movement -= 1;
        factors.push({ code: "NO_AUTO_HISTORY", points: -1, note: "No auto history" });
    }
    else if (args.openAutoTrades > 0) {
        factors.push({ code: "OPEN_AUTO_PRESENT", points: 0, note: "Open auto present; neutral in v1" });
    }
    // Stability - residence
    if ((args.residenceMonths ?? 0) > 24) {
        movement += 1;
        factors.push({ code: "RES_OVER_24", points: 1, note: "Residence over 24 months" });
    }
    else if ((args.residenceMonths ?? 0) >= 12) {
        movement += 0.5;
        factors.push({ code: "RES_12_24", points: 0.5, note: "Residence 12-24 months" });
    }
    else if ((args.residenceMonths ?? 0) < 6) {
        movement -= 1;
        factors.push({ code: "RES_UNDER_6", points: -1, note: "Residence under 6 months" });
    }
    // Cap total movement at +/- 2
    const cappedMovement = Math.max(-2, Math.min(2, roundHalfStep(movement)));
    const tier = moveTier("C", Math.trunc(cappedMovement));
    const tierRule = await loadTierPolicy(tier);
    return {
        decision: "approved",
        tier,
        scoreTotal: cappedMovement,
        hardStop: false,
        hardStopReason: null,
        maxTermMonths: tierRule.maxTermMonths,
        minCashDown: tierRule.minCashDown,
        minDownPct: tierRule.minDownPct,
        maxPti: tierRule.maxPti,
        maxAmountFinanced: tierRule.maxAmountFinanced,
        maxVehiclePrice: tierRule.maxVehiclePrice,
        maxLtv: tierRule.maxLtv,
        apr: tierRule.apr,
        scoreFactors: factors,
        notes: `Started at Tier C. Raw movement: ${movement}. Capped movement: ${cappedMovement}. Final tier: ${tier}.`,
    };
}
