import { z } from "zod";
import type { DealStructureComputedState, DealStructureInputsRecord } from "./dealStructureEngine";

type SupabaseClient = Awaited<
  ReturnType<typeof import("../supabase/server").supabaseServer>
>;

type DecisionAssistInventoryVehicle = {
  id: string;
  stock_number: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  odometer: number | null;
  status: string | null;
  asking_price: number | string | null;
  date_in_stock: string | null;
  jd_power_retail_book: number | string | null;
  vehicle_category: "car" | "suv" | "truck" | "van" | null;
};

type DecisionAssistContext = Awaited<
  ReturnType<typeof import("./dealStructureEngine").loadDealStructureContext>
>;

type DecisionAssistOverrides = {
  currentFingerprint: string;
  rawBlockers: string[];
  effectiveBlockers: string[];
  requests: Array<{ id: string; blocker_code: string; status: string }>;
};

export const DECISION_ASSIST_BLOCKER_PRIORITY = [
  "LTV",
  "AMOUNT_FINANCED",
  "VEHICLE_PRICE",
  "PTI",
] as const;

export const decisionAssistConsistencyStatusSchema = z.enum([
  "consistent",
  "review",
  "possible_anomaly",
]);

export const decisionAssistDealStrategyHintSchema = z.enum([
  "retail_viable",
  "near_approval",
  "needs_structure_change",
  "bhph_preferred",
  "high_risk",
]);

export const decisionAssistActionTypeSchema = z.enum([
  "increase_down_payment",
  "adjust_vehicle",
  "adjust_term",
  "remove_products",
  "add_products",
  "bhph_candidate",
  "lender_redirect",
]);

export const decisionAssistConfidenceSchema = z.enum(["low", "medium", "high"]);
export const decisionAssistReviewSourceSchema = z.enum([
  "openai",
  "deterministic_fallback",
]);

export const decisionAssistActionSchema = z.object({
  type: decisionAssistActionTypeSchema,
  description: z.string().min(1),
  impact: z.string().min(1),
  estimated_values: z
    .object({
      required_down: z.number().finite().nonnegative().optional(),
      estimated_payment: z.number().finite().nonnegative().optional(),
      term_months: z.number().int().positive().optional(),
      ltv: z.number().finite().nonnegative().optional(),
    })
    .partial()
    .optional(),
  confidence: decisionAssistConfidenceSchema,
});

export const decisionAssistReviewSchema = z.object({
  summary: z.string().min(1),
  consistency_status: decisionAssistConsistencyStatusSchema,
  deal_strategy_hint: decisionAssistDealStrategyHintSchema,
  review_source: decisionAssistReviewSourceSchema,
  review_model: z.string().nullable(),
  key_factors: z.array(z.string().min(1)),
  recommended_actions: z.array(decisionAssistActionSchema).min(1).max(3),
  human_review_recommendations: z.array(z.string().min(1)),
  policy_gap_flags: z.array(z.string().min(1)),
  confidence_note: z.string().min(1),
  disclaimer: z.string().min(1),
  trigger_reasons: z.array(z.string().min(1)),
});

export type DecisionAssistConsistencyStatus = z.infer<
  typeof decisionAssistConsistencyStatusSchema
>;
export type DecisionAssistDealStrategyHint = z.infer<
  typeof decisionAssistDealStrategyHintSchema
>;
export type DecisionAssistActionType = z.infer<
  typeof decisionAssistActionTypeSchema
>;
export type DecisionAssistConfidence = z.infer<
  typeof decisionAssistConfidenceSchema
>;
export type DecisionAssistReviewSource = z.infer<
  typeof decisionAssistReviewSourceSchema
>;
export type DecisionAssistAction = z.infer<typeof decisionAssistActionSchema>;
export type DealDecisionAssistReview = z.infer<typeof decisionAssistReviewSchema>;

export type DecisionAssistVehicleOptionScenario = {
  label: "NONE" | "VSC" | "GAP" | "VSC+GAP";
  include_vsc: boolean;
  include_gap: boolean;
  computed: DealStructureComputedState;
};

export type DecisionAssistVehicleOptionComparison = {
  vehicle: DealStructureComputedState["vehicle"];
  scenarios: DecisionAssistVehicleOptionScenario[];
};

type DecisionAssistCandidate = {
  action: DecisionAssistAction;
  targetBlocker: string | null;
  resolvesAllBlockers: boolean;
  severityScore: number;
  supportScore: number;
  numericRequired: boolean;
};

const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";

function getOpenAIApiKey() {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

function getOpenAIDecisionAssistModel() {
  return process.env.OPENAI_DECISION_ASSIST_MODEL?.trim() || "gpt-4o-mini";
}

function isOpenAIDecisionAssistConfigured() {
  return !!getOpenAIApiKey();
}

function extractOpenAIResponseText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const response = payload as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return "";
}

function round2(value: number) {
  return Number((value || 0).toFixed(2));
}

function money(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function percent(value: number | null | undefined) {
  return `${(Number(value ?? 0) * 100).toFixed(1)}%`;
}

function sameProductSelection(
  a: Pick<DealStructureComputedState["selection"], "include_vsc" | "include_gap">,
  b: Pick<DealStructureComputedState["selection"], "include_vsc" | "include_gap">
) {
  return a.include_vsc === b.include_vsc && a.include_gap === b.include_gap;
}

function inferNearApprovalMetric(computed: DealStructureComputedState) {
  const candidates: Array<{
    blocker: string;
    ratio: number;
  }> = [];

  if (computed.assumptions.max_ltv > 0 && computed.structure.ltv > 0) {
    candidates.push({
      blocker: "LTV",
      ratio: computed.structure.ltv / computed.assumptions.max_ltv,
    });
  }

  if (
    computed.assumptions.max_amount_financed > 0 &&
    computed.structure.amount_financed > 0
  ) {
    candidates.push({
      blocker: "AMOUNT_FINANCED",
      ratio:
        computed.structure.amount_financed / computed.assumptions.max_amount_financed,
    });
  }

  if (
    computed.assumptions.max_vehicle_price > 0 &&
    computed.structure.sale_price > 0
  ) {
    candidates.push({
      blocker: "VEHICLE_PRICE",
      ratio: computed.structure.sale_price / computed.assumptions.max_vehicle_price,
    });
  }

  if (
    computed.assumptions.max_payment_cap > 0 &&
    computed.structure.monthly_payment > 0
  ) {
    candidates.push({
      blocker: "PTI",
      ratio: computed.structure.monthly_payment / computed.assumptions.max_payment_cap,
    });
  }

  return candidates
    .filter((candidate) => candidate.ratio >= 0.95)
    .sort((a, b) => {
      const priorityDiff =
        DECISION_ASSIST_BLOCKER_PRIORITY.indexOf(
          a.blocker as (typeof DECISION_ASSIST_BLOCKER_PRIORITY)[number]
        ) -
        DECISION_ASSIST_BLOCKER_PRIORITY.indexOf(
          b.blocker as (typeof DECISION_ASSIST_BLOCKER_PRIORITY)[number]
        );

      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return b.ratio - a.ratio;
    })[0] ?? null;
}

function getPrimaryBlocker(computed: DealStructureComputedState) {
  for (const blocker of DECISION_ASSIST_BLOCKER_PRIORITY) {
    if (computed.structure.fail_reasons.includes(blocker)) {
      return blocker;
    }
  }

  return inferNearApprovalMetric(computed)?.blocker ?? null;
}

function getBlockerGap(
  computed: DealStructureComputedState,
  blocker: string | null
) {
  if (!blocker) return 0;

  if (blocker === "LTV") {
    return round2(computed.structure.additional_down_breakdown.ltv);
  }

  if (blocker === "AMOUNT_FINANCED") {
    return round2(computed.structure.additional_down_breakdown.amount_financed);
  }

  if (blocker === "PTI") {
    return round2(computed.structure.additional_down_breakdown.pti);
  }

  if (blocker === "VEHICLE_PRICE") {
    return round2(
      Math.max(
        0,
        Number(computed.structure.sale_price) -
          Number(computed.assumptions.max_vehicle_price)
      )
    );
  }

  return 0;
}

function buildTriggerReasons(args: {
  computed: DealStructureComputedState;
  overrides: DecisionAssistOverrides;
  underwritingDecision: string | null | undefined;
}) {
  const reasons: string[] = [];

  if (args.computed.structure.fail_reasons.length >= 2) {
    reasons.push("multi_fail");
  }

  if (args.overrides.requests.length > 0) {
    reasons.push("override_request");
  }

  if (
    args.computed.structure.fits_program &&
    inferNearApprovalMetric(args.computed) !== null
  ) {
    reasons.push("near_threshold_approval");
  }

  if (
    String(args.underwritingDecision ?? "").toLowerCase() === "denied" &&
    !!args.computed.assumptions.tier
  ) {
    reasons.push("non_hard_stop_denial");
  }

  return reasons;
}

export function shouldTriggerDealDecisionAssist(args: {
  computed: DealStructureComputedState;
  overrides: DecisionAssistOverrides;
  underwritingDecision: string | null | undefined;
}) {
  return (
    buildTriggerReasons({
      computed: args.computed,
      overrides: args.overrides,
      underwritingDecision: args.underwritingDecision,
    }).length > 0
  );
}

function buildVehicleLabel(vehicle: DealStructureComputedState["vehicle"]) {
  const label = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
  return vehicle.stock_number ? `${label} #${vehicle.stock_number}`.trim() : label || "another unit";
}

function confidenceForGap(value: number, highThreshold = 500, mediumThreshold = 2000) {
  if (value <= highThreshold) return "high";
  if (value <= mediumThreshold) return "medium";
  return "low";
}

function bestScenarioForVehicle(vehicleRow: DecisionAssistVehicleOptionComparison) {
  return [...vehicleRow.scenarios].sort((a, b) => {
    const fitDiff =
      Number(b.computed.structure.fits_program) - Number(a.computed.structure.fits_program);
    if (fitDiff !== 0) return fitDiff;

    const blockerDiff =
      a.computed.structure.fail_reasons.length - b.computed.structure.fail_reasons.length;
    if (blockerDiff !== 0) return blockerDiff;

    const downDiff =
      a.computed.structure.additional_down_needed -
      b.computed.structure.additional_down_needed;
    if (downDiff !== 0) return downDiff;

    return a.computed.structure.monthly_payment - b.computed.structure.monthly_payment;
  })[0] ?? null;
}

function scoreVehicleCandidate(
  current: DealStructureComputedState,
  candidate: DealStructureComputedState
) {
  const currentPrimary = getPrimaryBlocker(current);
  const candidateGap = getBlockerGap(candidate, currentPrimary);
  const currentGap = getBlockerGap(current, currentPrimary);

  return {
    resolvesAll: candidate.structure.fits_program,
    gapImprovement: round2(currentGap - candidateGap),
    severityScore:
      candidate.structure.fail_reasons.length * 10000 +
      candidate.structure.additional_down_needed,
  };
}

function buildVehicleAction(args: {
  current: DealStructureComputedState;
  vehicleRows: DecisionAssistVehicleOptionComparison[];
  primaryBlocker: string | null;
}) {
  const alternativeRows = args.vehicleRows
    .filter((row) => row.vehicle.id !== args.current.vehicle.id)
    .map((row) => {
      const bestScenario = bestScenarioForVehicle(row);
      if (!bestScenario) return null;

      return {
        row,
        scenario: bestScenario,
        score: scoreVehicleCandidate(args.current, bestScenario.computed),
      };
    })
    .filter(
      (
        entry
      ): entry is {
        row: DecisionAssistVehicleOptionComparison;
        scenario: DecisionAssistVehicleOptionScenario;
        score: ReturnType<typeof scoreVehicleCandidate>;
      } => !!entry
    )
    .sort((a, b) => {
      const fitDiff = Number(b.score.resolvesAll) - Number(a.score.resolvesAll);
      if (fitDiff !== 0) return fitDiff;

      if (a.score.severityScore !== b.score.severityScore) {
        return a.score.severityScore - b.score.severityScore;
      }

      return b.score.gapImprovement - a.score.gapImprovement;
    });

  const bestAlternative = alternativeRows[0];
  if (!bestAlternative) return null;

  const computed = bestAlternative.scenario.computed;
  const vehicleLabel = buildVehicleLabel(bestAlternative.row.vehicle);
  const confidence = computed.structure.fits_program
    ? "high"
    : confidenceForGap(computed.structure.additional_down_needed, 1000, 3000);

  const description = computed.structure.fits_program
    ? `Switch to ${vehicleLabel}; this structure fits at ${money(computed.structure.sale_price)}.`
    : `Switch to ${vehicleLabel}; this is the best-priced retail path at ${money(computed.structure.sale_price)}.`;

  const impactParts = [
    computed.structure.fits_program
      ? "This is the clearest retail path to approval."
      : `This reduces the current blocker gap to ${money(
          computed.structure.additional_down_needed
        )}.`,
    `Estimated payment ${money(computed.structure.monthly_payment)}.`,
  ];

  if (computed.vehicle.jd_power_retail_book > 0) {
    impactParts.push(`Estimated LTV ${percent(computed.structure.ltv)}.`);
  }

  return {
    action: {
      type: "adjust_vehicle" as const,
      description,
      impact: impactParts.join(" "),
      estimated_values: {
        estimated_payment: computed.structure.monthly_payment,
        ltv:
          computed.vehicle.jd_power_retail_book > 0 ? computed.structure.ltv : undefined,
      },
      confidence,
    },
    targetBlocker:
      args.primaryBlocker === "VEHICLE_PRICE" || args.primaryBlocker === "LTV"
        ? args.primaryBlocker
        : "LTV",
    resolvesAllBlockers: computed.structure.fits_program,
    severityScore: bestAlternative.score.severityScore,
    supportScore: computed.structure.fail_reasons.length,
    numericRequired: true,
  } satisfies DecisionAssistCandidate;
}

function buildDownPaymentAction(args: {
  current: DealStructureComputedState;
  blocker: string | null;
  nearApproval: boolean;
}) {
  const blocker = args.blocker;
  if (!blocker) return null;

  let additionalNeeded = getBlockerGap(args.current, blocker);

  if (args.nearApproval && additionalNeeded <= 0) {
    if (blocker === "PTI" && args.current.assumptions.max_payment_cap > 0) {
      const paymentGap =
        args.current.structure.monthly_payment -
        args.current.assumptions.max_payment_cap * 0.95;
      additionalNeeded = round2(Math.max(0, paymentGap) * args.current.structure.term_months);
    }

    if (blocker === "AMOUNT_FINANCED" && args.current.assumptions.max_amount_financed > 0) {
      additionalNeeded = round2(
        Math.max(
          0,
          args.current.structure.amount_financed -
            args.current.assumptions.max_amount_financed * 0.95
        )
      );
    }

    if (blocker === "LTV" && args.current.assumptions.max_ltv > 0) {
      const allowedFinanced = round2(
        args.current.vehicle.jd_power_retail_book * args.current.assumptions.max_ltv * 0.95
      );
      additionalNeeded = round2(
        Math.max(0, args.current.structure.amount_financed - allowedFinanced)
      );
    }
  }

  if (additionalNeeded <= 0) return null;

  const targetCashDown = round2(
    args.current.structure.cash_down_input + additionalNeeded
  );

  const description =
    blocker === "PTI"
      ? `Increase down payment to ${money(targetCashDown)} total to clear the payment cap.`
      : blocker === "AMOUNT_FINANCED"
        ? `Increase down payment to ${money(targetCashDown)} total to bring amount financed into policy.`
        : `Increase down payment to ${money(targetCashDown)} total to reduce LTV.`;

  const impact =
    blocker === "PTI"
      ? `This directly lowers the financed balance and targets the ${money(
          args.current.assumptions.max_payment_cap
        )} payment cap.`
      : blocker === "AMOUNT_FINANCED"
        ? `This reduces the financed balance toward the ${money(
            args.current.assumptions.max_amount_financed
          )} max amount financed limit.`
        : `This lowers financed amount against the ${percent(
            args.current.assumptions.max_ltv
          )} max LTV cap.`;

  return {
    action: {
      type: "increase_down_payment" as const,
      description,
      impact,
      estimated_values: {
        required_down: targetCashDown,
      },
      confidence: confidenceForGap(additionalNeeded),
    },
    targetBlocker: blocker,
    resolvesAllBlockers:
      additionalNeeded >= args.current.structure.additional_down_needed &&
      !args.current.structure.fail_reasons.includes("VEHICLE_PRICE"),
    severityScore: additionalNeeded,
    supportScore: 0,
    numericRequired: true,
  } satisfies DecisionAssistCandidate;
}

function buildProductAction(args: {
  type: "remove_products" | "add_products";
  current: DealStructureComputedState;
  scenario: DecisionAssistVehicleOptionScenario | null;
  targetBlocker: string | null;
}) {
  if (!args.scenario) return null;

  const currentProducts = args.current.structure.product_total;
  const nextProducts = args.scenario.computed.structure.product_total;
  const paymentImprovement = round2(
    args.current.structure.monthly_payment -
      args.scenario.computed.structure.monthly_payment
  );
  const downImprovement = round2(
    args.current.structure.additional_down_needed -
      args.scenario.computed.structure.additional_down_needed
  );

  if (
    args.type === "remove_products" &&
    (nextProducts >= currentProducts || downImprovement <= 0 && paymentImprovement <= 0)
  ) {
    return null;
  }

  if (
    args.type === "add_products" &&
    (nextProducts <= currentProducts || downImprovement <= 0 && paymentImprovement <= 0)
  ) {
    return null;
  }

  const description =
    args.type === "remove_products"
      ? `Remove backend products and rework at ${args.scenario.computed.structure.term_months} months.`
      : `Add VSC + GAP and rework at ${args.scenario.computed.structure.term_months} months.`;

  const impactParts = [
    `Estimated payment ${money(args.scenario.computed.structure.monthly_payment)}.`,
  ];

  if (downImprovement > 0) {
    impactParts.push(
      `This cuts the cash-to-close gap by ${money(downImprovement)}.`
    );
  }

  if (args.scenario.computed.vehicle.jd_power_retail_book > 0) {
    impactParts.push(`Estimated LTV ${percent(args.scenario.computed.structure.ltv)}.`);
  }

  return {
    action: {
      type: args.type,
      description,
      impact: impactParts.join(" "),
      estimated_values: {
        estimated_payment: args.scenario.computed.structure.monthly_payment,
        term_months: args.scenario.computed.structure.term_months,
        ltv:
          args.scenario.computed.vehicle.jd_power_retail_book > 0
            ? args.scenario.computed.structure.ltv
            : undefined,
      },
      confidence: args.scenario.computed.structure.fits_program ? "high" : "medium",
    },
    targetBlocker: args.targetBlocker,
    resolvesAllBlockers: args.scenario.computed.structure.fits_program,
    severityScore: args.scenario.computed.structure.additional_down_needed,
    supportScore: args.scenario.computed.structure.fail_reasons.length,
    numericRequired: true,
  } satisfies DecisionAssistCandidate;
}

function buildTermAction(args: {
  current: DealStructureComputedState;
  scenario: DecisionAssistVehicleOptionScenario | null;
  targetBlocker: string | null;
}) {
  if (!args.scenario) return null;
  if (args.scenario.computed.structure.term_months === args.current.structure.term_months) {
    return null;
  }

  if (
    args.scenario.computed.structure.monthly_payment >=
      args.current.structure.monthly_payment &&
    args.scenario.computed.structure.additional_down_needed >=
      args.current.structure.additional_down_needed
  ) {
    return null;
  }

  return {
    action: {
      type: "adjust_term",
      description: `Use ${args.scenario.computed.structure.term_months} months instead of ${args.current.structure.term_months}.`,
      impact: `Estimated payment moves to ${money(
        args.scenario.computed.structure.monthly_payment
      )}${args.scenario.computed.vehicle.jd_power_retail_book > 0 ? ` with LTV ${percent(args.scenario.computed.structure.ltv)}.` : "."}`,
      estimated_values: {
        estimated_payment: args.scenario.computed.structure.monthly_payment,
        term_months: args.scenario.computed.structure.term_months,
        ltv:
          args.scenario.computed.vehicle.jd_power_retail_book > 0
            ? args.scenario.computed.structure.ltv
            : undefined,
      },
      confidence: args.scenario.computed.structure.fits_program ? "high" : "medium",
    },
    targetBlocker: args.targetBlocker,
    resolvesAllBlockers: args.scenario.computed.structure.fits_program,
    severityScore: args.scenario.computed.structure.additional_down_needed,
    supportScore: args.scenario.computed.structure.fail_reasons.length,
    numericRequired: true,
  } satisfies DecisionAssistCandidate;
}

function buildFallbackAction(args: {
  current: DealStructureComputedState;
  underwritingDecision: string | null | undefined;
}) {
  const fallbackType =
    String(args.underwritingDecision ?? "").toLowerCase() === "denied" ||
    args.current.assumptions.tier === "BHPH"
      ? "bhph_candidate"
      : "lender_redirect";

  return {
    action: {
      type: fallbackType,
      description:
        fallbackType === "bhph_candidate"
          ? "Move this file to a BHPH-style review instead of forcing a retail structure."
          : "Redirect this file to a different lender lane; current retail structure has no clean path.",
      impact:
        fallbackType === "bhph_candidate"
          ? "Current retail constraints do not show a realistic approval path from available structure changes."
          : "Current retail constraints do not show a realistic approval path from available structure changes.",
      confidence: "medium",
    },
    targetBlocker: getPrimaryBlocker(args.current),
    resolvesAllBlockers: false,
    severityScore: Number.MAX_SAFE_INTEGER,
    supportScore: args.current.structure.fail_reasons.length,
    numericRequired: false,
  } satisfies DecisionAssistCandidate;
}

function dedupeCandidates(candidates: Array<DecisionAssistCandidate | null>) {
  const seen = new Set<string>();
  const deduped: DecisionAssistCandidate[] = [];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = `${candidate.action.type}:${candidate.action.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function sortCandidates(
  candidates: DecisionAssistCandidate[],
  primaryBlocker: string | null
) {
  return [...candidates].sort((a, b) => {
    const aPrimary = Number(a.targetBlocker === primaryBlocker);
    const bPrimary = Number(b.targetBlocker === primaryBlocker);
    if (aPrimary !== bPrimary) return bPrimary - aPrimary;

    const fitDiff = Number(b.resolvesAllBlockers) - Number(a.resolvesAllBlockers);
    if (fitDiff !== 0) return fitDiff;

    if (a.severityScore !== b.severityScore) {
      return a.severityScore - b.severityScore;
    }

    return a.supportScore - b.supportScore;
  });
}

function validateNumericGuidance(
  action: DecisionAssistAction,
  candidate: DecisionAssistCandidate
) {
  if (!candidate.numericRequired) {
    return true;
  }

  return !!action.estimated_values &&
    Object.values(action.estimated_values).some(
      (value) => value != null && Number.isFinite(value)
    );
}

function validatePrimaryAction(args: {
  review: DealDecisionAssistReview;
  primaryBlocker: string | null;
  candidates: DecisionAssistCandidate[];
}) {
  const firstAction = args.review.recommended_actions[0];
  const matchingCandidate = args.candidates.find(
    (candidate) =>
      candidate.action.type === firstAction.type &&
      candidate.action.description === firstAction.description
  );

  if (!matchingCandidate) {
    return false;
  }

  if (
    args.primaryBlocker &&
    matchingCandidate.targetBlocker !== args.primaryBlocker &&
    matchingCandidate.targetBlocker !== null
  ) {
    return false;
  }

  return validateNumericGuidance(firstAction, matchingCandidate);
}

function serializeEstimatedValues(
  estimatedValues: DecisionAssistAction["estimated_values"] | undefined
) {
  return JSON.stringify({
    estimated_payment: estimatedValues?.estimated_payment ?? null,
    ltv: estimatedValues?.ltv ?? null,
    required_down: estimatedValues?.required_down ?? null,
    term_months: estimatedValues?.term_months ?? null,
  });
}

function getCandidateKey(action: DecisionAssistAction) {
  return `${action.type}:${serializeEstimatedValues(action.estimated_values)}`;
}

function buildLlmPromptPayload(args: {
  computed: DealStructureComputedState;
  overrides: DecisionAssistOverrides;
  deterministicReview: DealDecisionAssistReview;
}) {
  return {
    deterministic_review: args.deterministicReview,
    review_constraints: {
      advisory_only: true,
      primary_action_must_match_deterministic_primary: true,
      allowed_action_types: args.deterministicReview.recommended_actions.map(
        (action) => action.type
      ),
      recommended_action_candidates: args.deterministicReview.recommended_actions.map(
        (action) => ({
          type: action.type,
          estimated_values: action.estimated_values ?? null,
          confidence: action.confidence,
        })
      ),
    },
    live_snapshot: {
      underwriting_decision: args.computed.assumptions.tier,
      fail_reasons: args.computed.structure.fail_reasons,
      structure: {
        sale_price: args.computed.structure.sale_price,
        amount_financed: args.computed.structure.amount_financed,
        monthly_payment: args.computed.structure.monthly_payment,
        term_months: args.computed.structure.term_months,
        ltv: args.computed.vehicle.jd_power_retail_book > 0
          ? args.computed.structure.ltv
          : null,
        additional_down_needed: args.computed.structure.additional_down_needed,
        additional_down_breakdown: args.computed.structure.additional_down_breakdown,
        fits_program: args.computed.structure.fits_program,
      },
      assumptions: {
        max_payment_cap: args.computed.assumptions.max_payment_cap,
        max_amount_financed: args.computed.assumptions.max_amount_financed,
        max_vehicle_price: args.computed.assumptions.max_vehicle_price,
        max_ltv: args.computed.assumptions.max_ltv,
        max_pti: args.computed.assumptions.max_pti,
        tier: args.computed.assumptions.tier,
      },
      vehicle: {
        stock_number: args.computed.vehicle.stock_number,
        year: args.computed.vehicle.year,
        make: args.computed.vehicle.make,
        model: args.computed.vehicle.model,
        asking_price: args.computed.vehicle.asking_price,
        jd_power_retail_book: args.computed.vehicle.jd_power_retail_book,
      },
      overrides: {
        request_count: args.overrides.requests.length,
        has_active_override_activity: args.overrides.requests.length > 0,
      },
    },
  };
}

async function requestOpenAIDecisionAssistReview(args: {
  deterministicReview: DealDecisionAssistReview;
  computed: DealStructureComputedState;
  overrides: DecisionAssistOverrides;
  validationError?: string | null;
}) {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return null;
  }

  const payload = buildLlmPromptPayload({
    computed: args.computed,
    overrides: args.overrides,
    deterministicReview: args.deterministicReview,
  });

  const correctionNote = args.validationError
    ? `The previous output was invalid: ${args.validationError}. Regenerate valid JSON that fixes only that issue.`
    : "";

  const response = await fetch(OPENAI_RESPONSES_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getOpenAIDecisionAssistModel(),
      max_output_tokens: 900,
      text: {
        format: {
          type: "json_object",
        },
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are a dealership underwriting decision-assist model. Return valid JSON only. " +
                "You are advisory only. Do not approve or deny deals, do not assign tier, do not override deterministic caps, and do not invent values. " +
                "Recommended actions must only come from the provided candidate actions. " +
                "Keep the first recommended action aligned with the deterministic best-next-step candidate. " +
                "If a candidate has numeric estimated_values, preserve them. " +
                "Write concise dealership-ready language for summary, descriptions, impact, human review recommendations, and policy gap flags.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `${correctionNote}\n` +
                "Return a JSON object with exactly these keys: " +
                "summary, consistency_status, deal_strategy_hint, review_source, review_model, key_factors, recommended_actions, human_review_recommendations, policy_gap_flags, confidence_note, disclaimer, trigger_reasons.\n" +
                "The enums must stay within the deterministic contract. " +
                "recommended_actions must contain 1 to 3 objects. " +
                "Use the provided payload only.\n\n" +
                JSON.stringify(payload),
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(details || `OpenAI returned ${response.status}.`);
  }

  const body = await response.json();
  const responseText = extractOpenAIResponseText(body);
  if (!responseText) {
    throw new Error("OpenAI response did not include JSON output.");
  }

  return JSON.parse(responseText) as unknown;
}

function validateAndNormalizeLlmReview(args: {
  candidateReview: unknown;
  deterministicReview: DealDecisionAssistReview;
  primaryBlocker: string | null;
}) {
  const parsed = decisionAssistReviewSchema.parse(args.candidateReview);
  const deterministicCandidateMap = new Map(
    args.deterministicReview.recommended_actions.map((action) => [
      getCandidateKey(action),
      action,
    ])
  );

  if (!parsed.recommended_actions.length) {
    throw new Error("recommended_actions cannot be empty");
  }

  const normalizedActions = parsed.recommended_actions.map((action) => {
    const matchingDeterministicAction = deterministicCandidateMap.get(
      getCandidateKey(action)
    );

    if (!matchingDeterministicAction) {
      throw new Error("recommended_actions must stay within deterministic candidate actions");
    }

    if (!validateNumericGuidance(action, {
      action: matchingDeterministicAction,
      targetBlocker: args.primaryBlocker,
      resolvesAllBlockers: false,
      severityScore: 0,
      supportScore: 0,
      numericRequired:
        !!matchingDeterministicAction.estimated_values &&
        Object.values(matchingDeterministicAction.estimated_values).some(
          (value) => value != null
        ),
    })) {
      throw new Error("numeric guidance was omitted for a candidate that requires it");
    }

    return {
      ...action,
      estimated_values: matchingDeterministicAction.estimated_values,
    };
  });

  const normalized = decisionAssistReviewSchema.parse({
    ...parsed,
    review_source: "openai",
    review_model: getOpenAIDecisionAssistModel(),
    recommended_actions: normalizedActions,
    trigger_reasons: args.deterministicReview.trigger_reasons,
    disclaimer:
      "Decision assist is advisory only. Atlas underwriting and structure calculations remain the source of truth.",
  });

  if (
    normalized.recommended_actions[0].type !==
    args.deterministicReview.recommended_actions[0]?.type
  ) {
    throw new Error("primary action did not match the deterministic best next step");
  }

  return normalized;
}

function buildKeyFactors(args: {
  computed: DealStructureComputedState;
  overrides: DecisionAssistOverrides;
}) {
  const factors: string[] = [];
  const { computed } = args;

  if (computed.structure.fail_reasons.includes("LTV")) {
    factors.push(
      `LTV is ${percent(computed.structure.ltv)} against a ${percent(
        computed.assumptions.max_ltv
      )} cap.`
    );
  }

  if (computed.structure.fail_reasons.includes("AMOUNT_FINANCED")) {
    factors.push(
      `Amount financed is ${money(
        computed.structure.amount_financed
      )} against a ${money(computed.assumptions.max_amount_financed)} cap.`
    );
  }

  if (computed.structure.fail_reasons.includes("VEHICLE_PRICE")) {
    factors.push(
      `Vehicle price is ${money(computed.structure.sale_price)} against a ${money(
        computed.assumptions.max_vehicle_price
      )} cap.`
    );
  }

  if (computed.structure.fail_reasons.includes("PTI")) {
    factors.push(
      `Payment is ${money(computed.structure.monthly_payment)} against a ${money(
        computed.assumptions.max_payment_cap
      )} cap.`
    );
  }

  const nearApproval = inferNearApprovalMetric(computed);
  if (computed.structure.fits_program && nearApproval) {
    factors.push(
      `Structure fits now, but ${nearApproval.blocker} is already within ${(
        100 -
        nearApproval.ratio * 100
      ).toFixed(1)}% of the program limit.`
    );
  }

  if (args.overrides.requests.length > 0) {
    factors.push(
      `${args.overrides.requests.length} override request${args.overrides.requests.length === 1 ? "" : "s"} already exist on this file.`
    );
  }

  if (!factors.length) {
    factors.push("Current structure inputs fit program rules without active blockers.");
  }

  return factors;
}

function buildHumanReviewNotes(args: {
  primaryAction: DecisionAssistAction;
  computed: DealStructureComputedState;
  overrides: DecisionAssistOverrides;
}) {
  const notes = [
    `Confirm the customer can support the primary action: ${args.primaryAction.description}`,
  ];

  if (args.overrides.requests.length > 0) {
    notes.push("Compare this recommendation against the open override history before escalating.");
  }

  if (args.computed.vehicle.jd_power_retail_book <= 0) {
    notes.push("Verify book value availability before relying on any LTV-driven recommendation.");
  }

  return notes;
}

function buildPolicyGapFlags(args: {
  underwritingDecision: string | null | undefined;
  computed: DealStructureComputedState;
  overrides: DecisionAssistOverrides;
}) {
  const flags: string[] = [];

  if (
    String(args.underwritingDecision ?? "").toLowerCase() === "denied" &&
    args.computed.structure.fits_program
  ) {
    flags.push("Underwriting decision is denied while the live structure fits current program rules.");
  }

  if (
    args.computed.structure.fail_reasons.length >= 2 &&
    args.overrides.requests.length > 0
  ) {
    flags.push("Repeated override activity on a multi-blocker file may indicate a policy or routing gap.");
  }

  if (args.computed.vehicle.jd_power_retail_book <= 0) {
    flags.push("Missing JD Power book value reduces confidence in LTV-driven guidance.");
  }

  return flags;
}

function buildConsistencyStatus(args: {
  underwritingDecision: string | null | undefined;
  computed: DealStructureComputedState;
  overrides: DecisionAssistOverrides;
  policyFlags: string[];
}) {
  if (
    args.policyFlags.some((flag) =>
      flag.includes("fits current program rules")
    )
  ) {
    return "possible_anomaly" as const;
  }

  if (
    args.overrides.requests.length > 0 ||
    (args.computed.structure.fits_program && inferNearApprovalMetric(args.computed))
  ) {
    return "review" as const;
  }

  return "consistent" as const;
}

function buildStrategyHint(args: {
  underwritingDecision: string | null | undefined;
  computed: DealStructureComputedState;
  candidates: DecisionAssistCandidate[];
  primaryBlocker: string | null;
}) {
  if (args.computed.structure.fits_program) {
    return inferNearApprovalMetric(args.computed) ? "near_approval" : "retail_viable";
  }

  const bestRetailCandidate = args.candidates.find(
    (candidate) =>
      candidate.action.type !== "bhph_candidate" &&
      candidate.action.type !== "lender_redirect"
  );

  if (!bestRetailCandidate) {
    return args.underwritingDecision === "denied" ? "bhph_preferred" : "high_risk";
  }

  if (
    args.primaryBlocker === "LTV" ||
    args.primaryBlocker === "VEHICLE_PRICE" ||
    args.computed.structure.fail_reasons.length >= 2
  ) {
    return "needs_structure_change";
  }

  if (bestRetailCandidate.resolvesAllBlockers) {
    return "near_approval";
  }

  return args.underwritingDecision === "denied" ? "high_risk" : "needs_structure_change";
}

function fallbackReview(args: {
  current: DealStructureComputedState;
  triggerReasons: string[];
  underwritingDecision: string | null | undefined;
}) {
  const fallback = buildFallbackAction({
    current: args.current,
    underwritingDecision: args.underwritingDecision,
  });

  return decisionAssistReviewSchema.parse({
    summary:
      "Current retail math does not show a clean approval path from the available structure changes.",
    consistency_status: "review",
    deal_strategy_hint:
      fallback.action.type === "bhph_candidate" ? "bhph_preferred" : "high_risk",
    review_source: "deterministic_fallback",
    review_model: null,
    key_factors: [
      `Active blockers: ${args.current.structure.fail_reasons.join(", ") || "none"}.`,
    ],
    recommended_actions: [fallback.action],
    human_review_recommendations: [
      "Review lender fit before spending more time on the current retail structure.",
    ],
    policy_gap_flags: [],
    confidence_note:
      "This recommendation is a bounded advisory fallback because no validated retail action ranked ahead of redirect/BHPH.",
    disclaimer:
      "Decision assist is advisory only. Atlas underwriting and structure calculations remain the source of truth.",
    trigger_reasons: args.triggerReasons,
  });
}

function chooseScenariosForCurrentVehicle(args: {
  current: DealStructureComputedState;
  currentVehicleRow: DecisionAssistVehicleOptionComparison | null;
}) {
  if (!args.currentVehicleRow) {
    return {
      removeProducts: null,
      addProducts: null,
    };
  }

  const removeProducts =
    args.currentVehicleRow.scenarios.find(
      (scenario) => !scenario.include_gap && !scenario.include_vsc
    ) ?? null;

  const addProducts =
    args.currentVehicleRow.scenarios.find(
      (scenario) => scenario.include_gap && scenario.include_vsc
    ) ?? null;

  return {
    removeProducts:
      removeProducts &&
      !sameProductSelection(removeProducts.computed.selection, args.current.selection)
        ? removeProducts
        : null,
    addProducts:
      addProducts &&
      !sameProductSelection(addProducts.computed.selection, args.current.selection)
        ? addProducts
        : null,
  };
}

export function buildDecisionAssistReview(args: {
  underwritingDecision: string | null | undefined;
  computed: DealStructureComputedState;
  overrides: DecisionAssistOverrides;
  vehicleRows: DecisionAssistVehicleOptionComparison[];
  shorterTermScenario: DecisionAssistVehicleOptionScenario | null;
  longerTermScenario: DecisionAssistVehicleOptionScenario | null;
}) {
  const triggerReasons = buildTriggerReasons({
    computed: args.computed,
    overrides: args.overrides,
    underwritingDecision: args.underwritingDecision,
  });

  if (!triggerReasons.length) {
    return null;
  }

  const primaryBlocker = getPrimaryBlocker(args.computed);
  const currentVehicleRow =
    args.vehicleRows.find((row) => row.vehicle.id === args.computed.vehicle.id) ?? null;
  const { removeProducts, addProducts } = chooseScenariosForCurrentVehicle({
    current: args.computed,
    currentVehicleRow,
  });

  const nearApproval =
    args.computed.structure.fits_program &&
    inferNearApprovalMetric(args.computed) !== null;

  const vehicleAction = buildVehicleAction({
    current: args.computed,
    vehicleRows: args.vehicleRows,
    primaryBlocker,
  });

  const downAction = buildDownPaymentAction({
    current: args.computed,
    blocker: primaryBlocker,
    nearApproval,
  });

  const termAction = buildTermAction({
    current: args.computed,
    scenario: args.longerTermScenario ?? args.shorterTermScenario,
    targetBlocker: primaryBlocker === "PTI" ? "PTI" : null,
  });

  const removeProductsAction = buildProductAction({
    type: "remove_products",
    current: args.computed,
    scenario: removeProducts,
    targetBlocker:
      primaryBlocker === "PTI" || primaryBlocker === "AMOUNT_FINANCED"
        ? primaryBlocker
        : null,
  });

  const addProductsAction = buildProductAction({
    type: "add_products",
    current: args.computed,
    scenario: addProducts,
    targetBlocker: primaryBlocker === "PTI" ? "PTI" : null,
  });

  let candidates = dedupeCandidates(
    primaryBlocker === "LTV"
      ? [vehicleAction, downAction, removeProductsAction]
      : primaryBlocker === "AMOUNT_FINANCED"
        ? [downAction, removeProductsAction, vehicleAction]
        : primaryBlocker === "VEHICLE_PRICE"
          ? [vehicleAction]
          : primaryBlocker === "PTI"
            ? [downAction, termAction, removeProductsAction, addProductsAction, vehicleAction]
            : [downAction, vehicleAction, termAction, removeProductsAction, addProductsAction]
  );

  if (!candidates.length) {
    candidates = [buildFallbackAction({
      current: args.computed,
      underwritingDecision: args.underwritingDecision,
    })];
  }

  const sorted = sortCandidates(candidates, primaryBlocker);
  const recommended = sorted.slice(0, 3).map((candidate) => candidate.action);

  const policyFlags = buildPolicyGapFlags({
    underwritingDecision: args.underwritingDecision,
    computed: args.computed,
    overrides: args.overrides,
  });

  const review = decisionAssistReviewSchema.parse({
    summary:
      args.computed.structure.fits_program
        ? `Deal fits today, but the structure is tight. Best next step: ${recommended[0].description}`
        : `Deal does not fit current retail rules. Best next step: ${recommended[0].description}`,
    consistency_status: buildConsistencyStatus({
      underwritingDecision: args.underwritingDecision,
      computed: args.computed,
      overrides: args.overrides,
      policyFlags,
    }),
    deal_strategy_hint: buildStrategyHint({
      underwritingDecision: args.underwritingDecision,
      computed: args.computed,
      candidates: sorted,
      primaryBlocker,
    }),
    review_source: "deterministic_fallback",
    review_model: null,
    key_factors: buildKeyFactors({
      computed: args.computed,
      overrides: args.overrides,
    }),
    recommended_actions: recommended,
    human_review_recommendations: buildHumanReviewNotes({
      primaryAction: recommended[0],
      computed: args.computed,
      overrides: args.overrides,
    }),
    policy_gap_flags: policyFlags,
    confidence_note:
      "Recommendations are ranked from deterministic structure math, option comparisons, and existing override context.",
    disclaimer:
      "Decision assist is advisory only. Atlas underwriting and structure calculations remain the source of truth.",
    trigger_reasons: triggerReasons,
  });

  if (!validatePrimaryAction({ review, primaryBlocker, candidates: sorted })) {
    return fallbackReview({
      current: args.computed,
      triggerReasons,
      underwritingDecision: args.underwritingDecision,
    });
  }

  for (const action of review.recommended_actions) {
    const candidate = sorted.find(
      (entry) =>
        entry.action.type === action.type &&
        entry.action.description === action.description
    );
    if (candidate && !validateNumericGuidance(action, candidate)) {
      return fallbackReview({
        current: args.computed,
        triggerReasons,
        underwritingDecision: args.underwritingDecision,
      });
    }
  }

  return review;
}

async function loadVehicleRows(args: {
  supabase: SupabaseClient;
  context: DecisionAssistContext;
}) {
  const { loadInventoryForOrganization } = require("../los/organizationScope") as typeof import("../los/organizationScope"); // eslint-disable-line @typescript-eslint/no-require-imports
  const { computeDealStructureState } = require("./dealStructureEngine") as typeof import("./dealStructureEngine"); // eslint-disable-line @typescript-eslint/no-require-imports
  const { data: vehicles, error } =
    await loadInventoryForOrganization<DecisionAssistInventoryVehicle>(
      args.supabase,
      args.context.organizationId,
      "id, stock_number, vin, year, make, model, odometer, status, asking_price, date_in_stock, jd_power_retail_book, vehicle_category",
      { limit: 120 }
    );

  if (error) {
    throw new Error(`Failed to load vehicle options for decision assist: ${error.message}`);
  }

  const baseInputs = args.context.inputs;
  const scenarioTemplates = [
    { label: "VSC+GAP" as const, include_vsc: true, include_gap: true },
    { label: "VSC" as const, include_vsc: true, include_gap: false },
    { label: "GAP" as const, include_vsc: false, include_gap: true },
    { label: "NONE" as const, include_vsc: false, include_gap: false },
  ];

  return ((vehicles ?? []) as DecisionAssistInventoryVehicle[])
    .map(
      (vehicle): DecisionAssistVehicleOptionComparison | null => {
      const scenarios = scenarioTemplates
        .map((template) => {
          try {
            return {
              label: template.label,
              include_vsc: template.include_vsc,
              include_gap: template.include_gap,
              computed: computeDealStructureState({
                dealId: args.context.deal.id,
                deal: args.context.deal,
                inputs: {
                  ...baseInputs,
                  vehicle_id: vehicle.id,
                  sale_price: Number(vehicle.asking_price ?? 0),
                  include_vsc: template.include_vsc,
                  include_gap: template.include_gap,
                  option_label: template.label,
                  term_months:
                    template.include_vsc && template.include_gap
                      ? Math.max(
                          1,
                          Number(
                            args.context.underwriting?.max_term_months ??
                              args.context.underwritingInputs?.term_months ??
                              baseInputs.term_months
                          )
                        )
                      : Math.max(
                          1,
                          Number(
                            (args.context.underwriting?.max_term_months ??
                              args.context.underwritingInputs?.term_months ??
                              baseInputs.term_months) - 6
                          )
                        ),
                },
                underwriting: args.context.underwriting,
                underwritingInputs: args.context.underwritingInputs,
                vehicle,
                vehicleTermPolicies: args.context.vehicleTermPolicies,
              }),
            };
          } catch {
            return null;
          }
        })
        .filter(
          (scenario): scenario is DecisionAssistVehicleOptionScenario => !!scenario
        );

      if (!scenarios.length) {
        return null;
      }

      return {
        vehicle: {
          id: vehicle.id,
          stock_number: vehicle.stock_number,
          vin: vehicle.vin,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          odometer: vehicle.odometer,
          status: vehicle.status,
          date_in_stock: vehicle.date_in_stock,
          asking_price: Number(vehicle.asking_price ?? 0),
          jd_power_retail_book: Number(vehicle.jd_power_retail_book ?? 0),
          vehicle_category: vehicle.vehicle_category,
          vehicle_age_years: null as number | null,
          vehicle_policy_max_term_months: null as number | null,
          vehicle_term_policy_note: null as string | null,
        },
        scenarios,
      };
      }
    )
    .filter((row): row is DecisionAssistVehicleOptionComparison => !!row);
}

async function buildTermScenario(args: {
  context: DecisionAssistContext;
  current: DealStructureComputedState;
  targetTermMonths: number | null;
}) {
  const { computeDealStructureState } = require("./dealStructureEngine") as typeof import("./dealStructureEngine"); // eslint-disable-line @typescript-eslint/no-require-imports
  const targetTermMonths = Number(args.targetTermMonths ?? 0);
  if (!Number.isFinite(targetTermMonths) || targetTermMonths <= 0) {
    return null;
  }

  if (targetTermMonths === args.current.structure.term_months) {
    return null;
  }

  try {
    return {
      label: args.current.selection.option_label,
      include_vsc: args.current.selection.include_vsc,
      include_gap: args.current.selection.include_gap,
      computed: computeDealStructureState({
        dealId: args.context.deal.id,
        deal: args.context.deal,
        inputs: {
          ...args.context.inputs,
          include_vsc: args.current.selection.include_vsc,
          include_gap: args.current.selection.include_gap,
          option_label: args.current.selection.option_label,
          term_months: targetTermMonths,
          sale_price: args.current.structure.sale_price,
          vehicle_id: args.current.vehicle.id,
        } satisfies DealStructureInputsRecord,
        underwriting: args.context.underwriting,
        underwritingInputs: args.context.underwritingInputs,
        vehicle: {
          ...args.context.vehicle,
          id: args.current.vehicle.id,
          asking_price: args.current.structure.sale_price,
        },
        vehicleTermPolicies: args.context.vehicleTermPolicies,
      }),
    };
  } catch {
    return null;
  }
}

export async function loadDealDecisionAssistReview(args: {
  supabase: SupabaseClient;
  context: DecisionAssistContext;
  computed: DealStructureComputedState;
  overrides: DecisionAssistOverrides;
}) {
  if (
    !shouldTriggerDealDecisionAssist({
      computed: args.computed,
      overrides: args.overrides,
      underwritingDecision: args.context.underwriting?.decision ?? null,
    })
  ) {
    return null;
  }

  const vehicleRows = await loadVehicleRows({
    supabase: args.supabase,
    context: args.context,
  });

  const longerTermScenario = await buildTermScenario({
    context: args.context,
    current: args.computed,
    targetTermMonths: args.computed.assumptions.vehicle_max_term_months,
  });

  const shorterTermScenario = await buildTermScenario({
    context: args.context,
    current: args.computed,
    targetTermMonths: Math.max(1, args.computed.structure.term_months - 6),
  });

  const deterministicReview = buildDecisionAssistReview({
    underwritingDecision: args.context.underwriting?.decision ?? null,
    computed: args.computed,
    overrides: args.overrides,
    vehicleRows,
    shorterTermScenario,
    longerTermScenario,
  });

  if (!deterministicReview) {
    return null;
  }

  if (!isOpenAIDecisionAssistConfigured()) {
    return deterministicReview;
  }

  const primaryBlocker = getPrimaryBlocker(args.computed);

  try {
    const firstAttempt = await requestOpenAIDecisionAssistReview({
      deterministicReview,
      computed: args.computed,
      overrides: args.overrides,
    });

    try {
      return validateAndNormalizeLlmReview({
        candidateReview: firstAttempt,
        deterministicReview,
        primaryBlocker,
      });
    } catch (validationError) {
      const message =
        validationError instanceof Error
          ? validationError.message
          : "invalid model output";

      const retryAttempt = await requestOpenAIDecisionAssistReview({
        deterministicReview,
        computed: args.computed,
        overrides: args.overrides,
        validationError: message,
      });

      return validateAndNormalizeLlmReview({
        candidateReview: retryAttempt,
        deterministicReview,
        primaryBlocker,
      });
    }
  } catch (error) {
    console.error("[dealDecisionAssist OpenAI fallback]", {
      error: error instanceof Error ? error.message : String(error),
      dealId: args.context.deal.id,
    });
    return deterministicReview;
  }
}
