import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreDealTier,
  type CoApplicantTierContext,
  type TierApplicantInput,
  type UnderwritingTier,
} from "../src/lib/underwriting/scoreDealTier.js";

const TIER_ORDER: UnderwritingTier[] = ["BHPH", "D", "C", "B", "A"];

const sharedAddress = {
  addressLine1: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
};

const otherAddress = {
  addressLine1: "999 Other Rd",
  city: "Austin",
  state: "TX",
  zip: "78701",
};

const behaviorCodes = new Set([
  "post_derog_clean_rebuild",
  "post_derog_dirty_rebuild",
  "bankruptcy_recent",
  "bankruptcy_old",
  "derog_after_bankruptcy",
  "clean_current_trades",
  "repeated_current_derog",
  "job_stability_strong",
  "job_stability_moderate",
  "job_stability_short",
  "job_stability_unknown",
]);

function monthsAgo(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
}

function applicant(overrides: Partial<TierApplicantInput> = {}): TierApplicantInput {
  return {
    score: 640,
    repoCount: 0,
    monthsSinceRepo: null,
    paidAutoTrades: 1,
    openAutoTrades: 1,
    residenceMonths: 18,
    totalTradelines: 5,
    openTradelines: 2,
    autosOnBureau: 1,
    unresolvedCollectionsCount: 0,
    unresolvedChargeoffsCount: 0,
    pastDueAmount: 0,
    publicRecordCount: 0,
    bankruptcyCount: 0,
    openAutoDerogatory: false,
    autoDeficiency: false,
    majorDerogAfterPublicRecord: false,
    hireDate: monthsAgo(18),
    ...overrides,
  };
}

function legacyMovement(input: TierApplicantInput) {
  let movement = 0;

  if (input.paidAutoTrades >= 2) movement += 1.5;
  else if (input.paidAutoTrades === 1) movement += 1;

  if (input.openAutoTrades === 0 && input.paidAutoTrades === 0) movement -= 1;

  if ((input.residenceMonths ?? 0) > 24) movement += 1;
  else if ((input.residenceMonths ?? 0) >= 12) movement += 0.5;
  else if ((input.residenceMonths ?? 0) < 6) movement -= 1;

  return Math.max(-2, Math.min(2, Math.round(movement * 2) / 2));
}

function legacyTier(primary: TierApplicantInput | null) {
  if (!primary) return null;
  if ((primary.score ?? 999) < 420) return null;
  if (
    primary.repoCount > 1 &&
    primary.monthsSinceRepo !== null &&
    primary.monthsSinceRepo < 12
  ) {
    return null;
  }

  const movement = legacyMovement(primary);
  const idx = Math.max(0, Math.min(TIER_ORDER.length - 1, TIER_ORDER.indexOf("C") + Math.trunc(movement)));
  return TIER_ORDER[idx];
}

function signalSummary(input: TierApplicantInput) {
  return {
    score: input.score,
    paidAutoTrades: input.paidAutoTrades,
    openAutoTrades: input.openAutoTrades,
    residenceMonths: input.residenceMonths,
    totalTradelines: input.totalTradelines,
    openTradelines: input.openTradelines,
    collections: input.unresolvedCollectionsCount,
    chargeoffs: input.unresolvedChargeoffsCount,
    pastDueAmount: input.pastDueAmount,
    monthsSinceBankruptcy: input.monthsSinceBankruptcy,
    publicRecordCount: input.publicRecordCount,
    bankruptcyCount: input.bankruptcyCount,
    openAutoDerogatory: input.openAutoDerogatory,
    autoDeficiency: input.autoDeficiency,
    majorDerogAfterPublicRecord: input.majorDerogAfterPublicRecord,
    hireDate: input.hireDate,
  };
}

function factorCodes(result: ReturnType<typeof scoreDealTier>) {
  return result.scoreFactors.map((factor) => factor.code);
}

function movementFromNotes(notes: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = notes.match(new RegExp(`${escaped}: (-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : null;
}

type Scenario = {
  name: string;
  primary: TierApplicantInput;
  coApplicant?: TierApplicantInput;
  coApplicantContext?: CoApplicantTierContext;
};

const validCoAppContext: CoApplicantTierContext = {
  householdIncome: true,
  hasAppliedIncome: true,
  primaryAddress: sharedAddress,
  coApplicantAddress: sharedAddress,
};

const scenarios: Scenario[] = [
  {
    name: "strong paid auto history + recent BK",
    primary: applicant({
      paidAutoTrades: 3,
      openAutoTrades: 1,
      residenceMonths: 48,
      totalTradelines: 8,
      openTradelines: 3,
      monthsSinceBankruptcy: 8,
      publicRecordCount: 1,
      bankruptcyCount: 1,
      hireDate: monthsAgo(60),
    }),
  },
  {
    name: "thin file + good residence/job",
    primary: applicant({
      paidAutoTrades: 0,
      openAutoTrades: 0,
      residenceMonths: 48,
      totalTradelines: 2,
      openTradelines: 1,
      autosOnBureau: 0,
      hireDate: monthsAgo(48),
    }),
  },
  {
    name: "valid strong co-app + borderline primary",
    primary: applicant({
      paidAutoTrades: 0,
      openAutoTrades: 1,
      residenceMonths: 12,
      totalTradelines: 4,
      openTradelines: 1,
      hireDate: monthsAgo(10),
    }),
    coApplicant: applicant({
      paidAutoTrades: 3,
      openAutoTrades: 1,
      residenceMonths: 60,
      totalTradelines: 9,
      openTradelines: 4,
      autosOnBureau: 3,
      hireDate: monthsAgo(72),
    }),
    coApplicantContext: validCoAppContext,
  },
  {
    name: "invalid co-app + borderline primary",
    primary: applicant({
      paidAutoTrades: 0,
      openAutoTrades: 1,
      residenceMonths: 12,
      totalTradelines: 4,
      openTradelines: 1,
      hireDate: monthsAgo(10),
    }),
    coApplicant: applicant({
      paidAutoTrades: 3,
      openAutoTrades: 1,
      residenceMonths: 60,
      totalTradelines: 9,
      openTradelines: 4,
      autosOnBureau: 3,
      hireDate: monthsAgo(72),
    }),
    coApplicantContext: {
      ...validCoAppContext,
      coApplicantAddress: otherAddress,
    },
  },
  {
    name: "weak valid co-app + decent primary",
    primary: applicant({
      paidAutoTrades: 2,
      openAutoTrades: 1,
      residenceMonths: 36,
      totalTradelines: 7,
      openTradelines: 3,
      hireDate: monthsAgo(36),
    }),
    coApplicant: applicant({
      paidAutoTrades: 0,
      openAutoTrades: 0,
      residenceMonths: 3,
      totalTradelines: 2,
      openTradelines: 1,
      autosOnBureau: 0,
      hireDate: monthsAgo(3),
    }),
    coApplicantContext: validCoAppContext,
  },
  {
    name: "heavy collections/chargeoffs",
    primary: applicant({
      paidAutoTrades: 2,
      openAutoTrades: 1,
      residenceMonths: 36,
      totalTradelines: 8,
      openTradelines: 3,
      unresolvedCollectionsCount: 4,
      unresolvedChargeoffsCount: 2,
      pastDueAmount: 3500,
      hireDate: monthsAgo(42),
    }),
  },
  {
    name: "short job time but otherwise decent file",
    primary: applicant({
      paidAutoTrades: 2,
      openAutoTrades: 1,
      residenceMonths: 36,
      totalTradelines: 7,
      openTradelines: 3,
      hireDate: monthsAgo(3),
    }),
  },
  {
    name: "long job time but capped by derogatory",
    primary: applicant({
      paidAutoTrades: 2,
      openAutoTrades: 1,
      residenceMonths: 48,
      totalTradelines: 8,
      openTradelines: 3,
      unresolvedCollectionsCount: 4,
      unresolvedChargeoffsCount: 2,
      pastDueAmount: 4500,
      openAutoDerogatory: true,
      autoDeficiency: true,
      hireDate: monthsAgo(84),
    }),
  },
];

test("underwriting tier comparison report for sample scenarios", () => {
  const report = scenarios.map((scenario) => {
    const result = scoreDealTier({
      primary: scenario.primary,
      coApplicant: scenario.coApplicant,
      coApplicantContext: scenario.coApplicantContext,
    });
    const codes = factorCodes(result);

    return {
      scenarioName: scenario.name,
      oldStyleTier: legacyTier(scenario.primary),
      primarySignals: signalSummary(scenario.primary),
      coApplicantSignals: scenario.coApplicant ? signalSummary(scenario.coApplicant) : null,
      rawMovement: movementFromNotes(result.notes, "Raw movement"),
      behaviorModifiers: {
        movement: movementFromNotes(result.notes, "Behavior movement"),
        factors: result.scoreFactors
          .filter((factor) => behaviorCodes.has(factor.code))
          .map((factor) => ({
            code: factor.code,
            points: factor.points,
            note: factor.note,
          })),
      },
      capsApplied: result.scoreFactors
        .filter((factor) => factor.code.startsWith("tier_cap_"))
        .map((factor) => factor.code),
      finalTier: result.tier,
      scoreFactors: codes,
    };
  });

  console.log(JSON.stringify({ underwritingTierComparisonReport: report }, null, 2));

  assert.equal(report.length, 8);
  assert.ok(report.every((row) => row.finalTier));
});
