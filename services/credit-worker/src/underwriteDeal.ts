// services/credit-worker/src/underwriteDeal.ts

type Tier = "A" | "B" | "C" | "D" | "BHPH";

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

const TIER_ORDER: Tier[] = ["BHPH", "D", "C", "B", "A"];

function clampTierIndex(idx: number): number {
  return Math.max(0, Math.min(TIER_ORDER.length - 1, idx));
}

function moveTier(start: Tier, delta: number): Tier {
  const startIdx = TIER_ORDER.indexOf(start);
  return TIER_ORDER[clampTierIndex(startIdx + delta)];
}

function roundHalfStep(value: number): number {
  return Math.round(value * 2) / 2;
}

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

export function calcJobMonthsFromHireDate(hireDate: string | null | undefined): number | null {
  return monthsBetween(hireDate);
}

export function underwriteDeal(args: UnderwriteArgs): UnderwriteResult {
  const factors: UnderwriteResult["scoreFactors"] = [];

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
  } else if (args.paidAutoTrades === 1) {
    movement += 1;
    factors.push({ code: "PAID_AUTOS_1", points: 1, note: "1 paid auto trade" });
  }

  // Open auto trades
  if (args.openAutoTrades === 0 && args.paidAutoTrades === 0) {
    movement -= 1;
    factors.push({ code: "NO_AUTO_HISTORY", points: -1, note: "No auto history" });
  } else if (args.openAutoTrades > 0) {
    // We do not have reliable open-auto age normalization yet, so hold neutral for v1
    factors.push({ code: "OPEN_AUTO_PRESENT", points: 0, note: "Open auto present; neutral in v1" });
  }

  // Stability - residence
  if ((args.residenceMonths ?? 0) > 24) {
    movement += 1;
    factors.push({ code: "RES_OVER_24", points: 1, note: "Residence over 24 months" });
  } else if ((args.residenceMonths ?? 0) >= 12) {
    movement += 0.5;
    factors.push({ code: "RES_12_24", points: 0.5, note: "Residence 12-24 months" });
  } else if ((args.residenceMonths ?? 0) < 6) {
    movement -= 1;
    factors.push({ code: "RES_UNDER_6", points: -1, note: "Residence under 6 months" });
  }

  /*
  // Stability - job
  if ((args.jobMonths ?? 0) > 24) {
    movement += 1;
    factors.push({ code: "JOB_OVER_24", points: 1, note: "Job over 24 months" });
  } else if ((args.jobMonths ?? 0) >= 12) {
    movement += 0.5;
    factors.push({ code: "JOB_12_24", points: 0.5, note: "Job 12-24 months" });
  } else if ((args.jobMonths ?? 0) < 6) {
    movement -= 1;
    factors.push({ code: "JOB_UNDER_6", points: -1, note: "Job under 6 months" });
  }

  // Repo impact
  if (args.repoCount > 0 && args.monthsSinceRepo !== null) {
    if (args.monthsSinceRepo < 12) {
      movement -= 1.5;
      factors.push({ code: "REPO_LT_12", points: -1.5, note: "Repo under 12 months" });
    } else if (args.monthsSinceRepo < 24) {
      movement -= 1;
      factors.push({ code: "REPO_12_24", points: -1, note: "Repo 12-24 months" });
    } else if (args.monthsSinceRepo < 48) {
      movement -= 0.5;
      factors.push({ code: "REPO_24_48", points: -0.5, note: "Repo 24-48 months" });
    }
  }
*/

  /*
    // Cash down adjustment
    const downPct =
      args.vehiclePrice > 0 ? (args.cashDown / args.vehiclePrice) * 100 : 0;
  
    if (downPct > 20) {
      movement += 2;
      factors.push({ code: "DOWN_GT_20", points: 2, note: "Cash down over 20%" });
    } else if (downPct >= 15) {
      movement += 1;
      factors.push({ code: "DOWN_15_20", points: 1, note: "Cash down 15-20%" });
    } else if (downPct < 10) {
      movement -= 1;
      factors.push({ code: "DOWN_LT_10", points: -1, note: "Cash down under 10%" });
    }
  
  */

  // Cap total movement at +/- 2
  const cappedMovement = Math.max(-2, Math.min(2, roundHalfStep(movement)));

  let tier = moveTier("C", Math.trunc(cappedMovement));

  const tierMatrix: Record<
    Tier,
    {
      maxTermMonths: number;
      minCashDown: number;
      maxPti: number;
      minDownPct: number;
      maxAmountFinanced: number;
      maxVehiclePrice: number;
      maxLtv: number;
      apr: number;
    }
  > = {
    A: {
      maxTermMonths: 60,
      minCashDown: 500,
      maxPti: 0.22,
      minDownPct: 0.05,
      maxAmountFinanced: 25000,
      maxVehiclePrice: 25000,
      maxLtv: 1.5,
      apr: 28.99,
    },
    B: {
      maxTermMonths: 54,
      minCashDown: 750,
      maxPti: 0.20,
      minDownPct: 0.07,
      maxAmountFinanced: 22000,
      maxVehiclePrice: 22000,
      maxLtv: 1.4,
      apr: 28.99,
    },
    C: {
      maxTermMonths: 48,
      minCashDown: 1000,
      maxPti: 0.18,
      minDownPct: 0.10,
      maxAmountFinanced: 18000,
      maxVehiclePrice: 18000,
      maxLtv: 1.3,
      apr: 28.99,
    },
    D: {
      maxTermMonths: 42,
      minCashDown: 1500,
      maxPti: 0.16,
      minDownPct: 0.12,
      maxAmountFinanced: 15000,
      maxVehiclePrice: 15000,
      maxLtv: 1.2,
      apr: 28.99,
    },
    BHPH: {
      maxTermMonths: 36,
      minCashDown: 1500,
      maxPti: 0.15,
      minDownPct: 0.15,
      maxAmountFinanced: 12000,
      maxVehiclePrice: 12000,
      maxLtv: 1.1,
      apr: 28.99,
    },
  };

  const tierRule = tierMatrix[tier as Tier];

  if (!tierRule) {
    throw new Error(`Invalid tier produced by underwriting engine: ${tier}`);
  }

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