import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreDealTier,
  type TierApplicantInput,
} from "../src/lib/underwriting/scoreDealTier.js";

const address = {
  addressLine1: "123 Main St.",
  city: "Austin",
  state: "TX",
  zip: "78701",
};

function applicant(overrides: Partial<TierApplicantInput> = {}): TierApplicantInput {
  return {
    score: 640,
    repoCount: 0,
    monthsSinceRepo: null,
    paidAutoTrades: 1,
    openAutoTrades: 1,
    residenceMonths: 12,
    ...overrides,
  };
}

function strongApplicant(overrides: Partial<TierApplicantInput> = {}): TierApplicantInput {
  return applicant({
    paidAutoTrades: 2,
    openAutoTrades: 1,
    residenceMonths: 36,
    totalTradelines: 6,
    openTradelines: 2,
    autosOnBureau: 2,
    unresolvedCollectionsCount: 0,
    unresolvedChargeoffsCount: 0,
    pastDueAmount: 0,
    ...overrides,
  });
}

function codes(result: ReturnType<typeof scoreDealTier>) {
  return result.scoreFactors.map((factor) => factor.code);
}

function isoMonthsAgo(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
}

test("primary-only deal matches existing tier behavior", () => {
  const result = scoreDealTier({
    primary: applicant(),
  });

  assert.equal(result.decision, "approved");
  assert.equal(result.scoreTotal, 1.5);
  assert.equal(result.tier, "B");
});

test("primary long tenure modestly improves tier movement", () => {
  const baseline = scoreDealTier({
    primary: applicant(),
  });
  const stable = scoreDealTier({
    primary: applicant({ hireDate: isoMonthsAgo(30) }),
  });

  assert.ok(stable.scoreTotal > baseline.scoreTotal);
  assert.ok(codes(stable).includes("job_stability_strong"));
});

test("primary short tenure mildly worsens tier movement", () => {
  const baseline = scoreDealTier({
    primary: applicant(),
  });
  const short = scoreDealTier({
    primary: applicant({ hireDate: isoMonthsAgo(3) }),
  });

  assert.ok(short.scoreTotal < baseline.scoreTotal);
  assert.ok(codes(short).includes("job_stability_short"));
});

test("unknown hire_date does not change movement", () => {
  const baseline = scoreDealTier({
    primary: applicant(),
  });
  const unknown = scoreDealTier({
    primary: applicant({ hireDate: null }),
  });

  assert.equal(unknown.scoreTotal, baseline.scoreTotal);
  assert.ok(codes(unknown).includes("job_stability_unknown"));
});

test("co-app bureau exists but household income false skips co-app", () => {
  const result = scoreDealTier({
    primary: applicant(),
    coApplicant: applicant({ paidAutoTrades: 2, residenceMonths: 36 }),
    coApplicantContext: {
      householdIncome: false,
      hasAppliedIncome: true,
      primaryAddress: address,
      coApplicantAddress: address,
    },
  });

  assert.equal(result.tier, "B");
  assert.equal(result.coApplicantApplied, false);
  assert.ok(codes(result).includes("coapp_skipped_household_income_off"));
});

test("valid co-app job stability contributes only when co-app weighting applies", () => {
  const result = scoreDealTier({
    primary: applicant(),
    coApplicant: applicant({ hireDate: isoMonthsAgo(30) }),
    coApplicantContext: {
      householdIncome: true,
      hasAppliedIncome: true,
      primaryAddress: address,
      coApplicantAddress: address,
    },
  });

  assert.equal(result.coApplicantApplied, true);
  assert.ok(codes(result).includes("coapp_weighting_applied"));
  assert.ok(codes(result).includes("job_stability_strong"));
});

test("invalid co-app job stability is ignored", () => {
  const result = scoreDealTier({
    primary: applicant(),
    coApplicant: applicant({ hireDate: isoMonthsAgo(30) }),
    coApplicantContext: {
      householdIncome: false,
      hasAppliedIncome: true,
      primaryAddress: address,
      coApplicantAddress: address,
    },
  });

  assert.equal(result.coApplicantApplied, false);
  assert.equal(codes(result).filter((code) => code === "job_stability_strong").length, 0);
  assert.ok(codes(result).includes("job_stability_unknown"));
});

test("household income true but no co-app applied income skips co-app", () => {
  const result = scoreDealTier({
    primary: applicant(),
    coApplicant: applicant({ paidAutoTrades: 2, residenceMonths: 36 }),
    coApplicantContext: {
      householdIncome: true,
      hasAppliedIncome: false,
      primaryAddress: address,
      coApplicantAddress: address,
    },
  });

  assert.equal(result.tier, "B");
  assert.equal(result.coApplicantApplied, false);
  assert.ok(codes(result).includes("coapp_skipped_no_applied_income"));
});

test("co-app applied income with residence mismatch skips co-app", () => {
  const result = scoreDealTier({
    primary: applicant(),
    coApplicant: applicant({ paidAutoTrades: 2, residenceMonths: 36 }),
    coApplicantContext: {
      householdIncome: true,
      hasAppliedIncome: true,
      primaryAddress: address,
      coApplicantAddress: {
        addressLine1: "999 Other Rd",
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
    },
  });

  assert.equal(result.tier, "B");
  assert.equal(result.coApplicantApplied, false);
  assert.ok(codes(result).includes("coapp_skipped_residence_mismatch"));
});

test("valid co-app applies 70/30 weighting", () => {
  const result = scoreDealTier({
    primary: applicant({ paidAutoTrades: 0, openAutoTrades: 1, residenceMonths: 12 }),
    coApplicant: applicant({ paidAutoTrades: 2, openAutoTrades: 1, residenceMonths: 36 }),
    coApplicantContext: {
      householdIncome: true,
      hasAppliedIncome: true,
      primaryAddress: address,
      coApplicantAddress: {
        addressLine1: " 123 main st ",
        city: "AUSTIN",
        state: "tx",
        zip: "78701",
      },
    },
  });

  assert.equal(result.coApplicantApplied, true);
  assert.equal(result.scoreTotal, 1);
  assert.equal(result.tier, "B");
  assert.ok(codes(result).includes("coapp_weighting_applied"));
});

test("weak valid co-app can reduce tier", () => {
  const primaryOnly = scoreDealTier({
    primary: applicant({ paidAutoTrades: 2, openAutoTrades: 1, residenceMonths: 36 }),
  });
  const weighted = scoreDealTier({
    primary: applicant({ paidAutoTrades: 2, openAutoTrades: 1, residenceMonths: 36 }),
    coApplicant: applicant({ paidAutoTrades: 0, openAutoTrades: 0, residenceMonths: 0 }),
    coApplicantContext: {
      householdIncome: true,
      hasAppliedIncome: true,
      primaryAddress: address,
      coApplicantAddress: address,
    },
  });

  assert.equal(primaryOnly.tier, "A");
  assert.equal(weighted.tier, "B");
});

test("strong valid co-app can improve tier", () => {
  const primaryOnly = scoreDealTier({
    primary: applicant({ paidAutoTrades: 0, openAutoTrades: 1, residenceMonths: 12 }),
  });
  const weighted = scoreDealTier({
    primary: applicant({ paidAutoTrades: 0, openAutoTrades: 1, residenceMonths: 12 }),
    coApplicant: applicant({ paidAutoTrades: 2, openAutoTrades: 1, residenceMonths: 36 }),
    coApplicantContext: {
      householdIncome: true,
      hasAppliedIncome: true,
      primaryAddress: address,
      coApplicantAddress: address,
    },
  });

  assert.equal(primaryOnly.tier, "C");
  assert.equal(weighted.tier, "B");
});

test("co-app scoring without primary bureau is blocked", () => {
  const result = scoreDealTier({
    primary: null,
    coApplicant: applicant({ paidAutoTrades: 2, residenceMonths: 36 }),
    coApplicantContext: {
      householdIncome: true,
      hasAppliedIncome: true,
      primaryAddress: null,
      coApplicantAddress: address,
    },
  });

  assert.equal(result.decision, "denied");
  assert.equal(result.hardStop, true);
  assert.equal(result.tier, null);
  assert.ok(codes(result).includes("coapp_skipped_no_primary_bureau"));
});

test("strong paid-auto history plus recent bankruptcy cannot reach A", () => {
  const result = scoreDealTier({
    primary: strongApplicant({ monthsSinceBankruptcy: 12, hireDate: isoMonthsAgo(60) }),
  });

  assert.equal(result.tier, "B");
  assert.ok(codes(result).includes("tier_cap_recent_bankruptcy"));
});

test("job stability cannot overcome tier caps", () => {
  const result = scoreDealTier({
    primary: strongApplicant({
      monthsSinceBankruptcy: 12,
      hireDate: isoMonthsAgo(60),
    }),
  });

  assert.equal(result.tier, "B");
  assert.ok(codes(result).includes("job_stability_strong"));
  assert.ok(codes(result).includes("tier_cap_recent_bankruptcy"));
});

test("recent BK with clean rebuild scores better than recent BK with dirty rebuild, but remains capped", () => {
  const clean = scoreDealTier({
    primary: strongApplicant({ monthsSinceBankruptcy: 12 }),
  });
  const dirty = scoreDealTier({
    primary: strongApplicant({
      monthsSinceBankruptcy: 12,
      unresolvedCollectionsCount: 1,
      openTradelines: 0,
    }),
  });

  assert.equal(clean.tier, "B");
  assert.equal(dirty.tier, "B");
  assert.ok(clean.scoreTotal > dirty.scoreTotal);
  assert.ok(codes(clean).includes("bankruptcy_recent"));
  assert.ok(codes(clean).includes("post_derog_clean_rebuild"));
  assert.ok(codes(dirty).includes("post_derog_dirty_rebuild"));
  assert.ok(codes(clean).includes("tier_cap_recent_bankruptcy"));
});

test("old bankruptcy with clean rebuild can score better than dirty rebuild", () => {
  const clean = scoreDealTier({
    primary: strongApplicant({ monthsSinceBankruptcy: 60 }),
  });
  const dirty = scoreDealTier({
    primary: strongApplicant({
      monthsSinceBankruptcy: 60,
      unresolvedCollectionsCount: 1,
      totalTradelines: 1,
      openTradelines: 0,
    }),
  });

  assert.equal(clean.tier, "A");
  assert.equal(dirty.tier, "B");
  assert.ok(codes(clean).includes("bankruptcy_old"));
  assert.ok(codes(clean).includes("post_derog_clean_rebuild"));
  assert.ok(codes(dirty).includes("post_derog_dirty_rebuild"));
  assert.ok(codes(dirty).includes("tier_cap_old_bankruptcy_dirty_rebuild"));
});

test("post-BK derogatories cap lower", () => {
  const result = scoreDealTier({
    primary: strongApplicant({
      monthsSinceBankruptcy: 60,
      majorDerogAfterPublicRecord: true,
    }),
  });

  assert.equal(result.tier, "C");
  assert.ok(codes(result).includes("derog_after_bankruptcy"));
  assert.ok(codes(result).includes("tier_cap_post_bankruptcy_derog"));
});

test("clean current trades modestly improve score", () => {
  const baseline = scoreDealTier({
    primary: applicant(),
  });
  const clean = scoreDealTier({
    primary: applicant({
      totalTradelines: 4,
      openTradelines: 2,
      unresolvedCollectionsCount: 0,
      unresolvedChargeoffsCount: 0,
      pastDueAmount: 0,
    }),
  });

  assert.ok(clean.scoreTotal > baseline.scoreTotal);
  assert.ok(codes(clean).includes("clean_current_trades"));
});

test("repeated current derog modestly worsens score", () => {
  const baseline = scoreDealTier({
    primary: applicant(),
  });
  const dirty = scoreDealTier({
    primary: applicant({
      unresolvedCollectionsCount: 1,
      unresolvedChargeoffsCount: 1,
      pastDueAmount: 250,
    }),
  });

  assert.ok(dirty.scoreTotal < baseline.scoreTotal);
  assert.ok(codes(dirty).includes("repeated_current_derog"));
});

test("heavy collections and chargeoffs cap at C", () => {
  const result = scoreDealTier({
    primary: strongApplicant({
      totalCollections: 3,
      unresolvedCollectionsCount: 3,
      unresolvedChargeoffsCount: 2,
    }),
  });

  assert.equal(result.tier, "C");
  assert.ok(codes(result).includes("tier_cap_heavy_collections_chargeoffs"));
});

test("open auto derogatory caps at C", () => {
  const result = scoreDealTier({
    primary: strongApplicant({
      openAutoDerogatory: true,
    }),
  });

  assert.equal(result.tier, "C");
  assert.ok(codes(result).includes("tier_cap_open_auto_derog"));
});

test("thin file cannot reach A", () => {
  const result = scoreDealTier({
    primary: strongApplicant({
      totalTradelines: 2,
      openTradelines: 1,
    }),
  });

  assert.equal(result.tier, "B");
  assert.ok(codes(result).includes("tier_cap_thin_file"));
});

test("no prior auto with weak depth cannot reach A", () => {
  const result = scoreDealTier({
    primary: applicant({
      paidAutoTrades: 0,
      openAutoTrades: 0,
      residenceMonths: 36,
      totalTradelines: 3,
      openTradelines: 2,
      autosOnBureau: 0,
    }),
    coApplicant: strongApplicant(),
    coApplicantContext: {
      householdIncome: true,
      hasAppliedIncome: true,
      primaryAddress: address,
      coApplicantAddress: address,
    },
  });

  assert.notEqual(result.tier, "A");
  assert.ok(codes(result).includes("tier_cap_no_auto_weak_depth"));
});
