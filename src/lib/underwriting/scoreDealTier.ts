export type UnderwritingTier = "A" | "B" | "C" | "D" | "BHPH";

export type TierScoreFactor = {
  code: string;
  points: number;
  note: string;
};

export type TierApplicantInput = {
  score: number | null;
  repoCount: number;
  monthsSinceRepo: number | null;
  paidAutoTrades: number;
  openAutoTrades: number;
  residenceMonths: number | null;
  monthsSinceBankruptcy?: number | null;
  unresolvedCollectionsCount?: number | null;
  unresolvedChargeoffsCount?: number | null;
  publicRecordCount?: number | null;
  bankruptcyCount?: number | null;
  bankruptcyDateUnknown?: boolean | null;
  totalCollections?: number | null;
  totalChargeoffs?: number | null;
  pastDueAmount?: number | null;
  totalTradelines?: number | null;
  openTradelines?: number | null;
  autosOnBureau?: number | null;
  openAutoDerogatory?: boolean | null;
  autoDeficiency?: boolean | null;
  majorDerogAfterPublicRecord?: boolean | null;
  hireDate?: string | null;
};

export type TierApplicantAddress = {
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type CoApplicantTierContext = {
  householdIncome: boolean;
  hasAppliedIncome: boolean;
  primaryAddress: TierApplicantAddress | null;
  coApplicantAddress: TierApplicantAddress | null;
};

export type ScoreDealTierArgs = {
  primary: TierApplicantInput | null;
  coApplicant?: TierApplicantInput | null;
  coApplicantContext?: CoApplicantTierContext;
};

export type ScoreDealTierResult = {
  decision: "approved" | "denied";
  tier: UnderwritingTier | null;
  scoreTotal: number;
  hardStop: boolean;
  hardStopReason: string | null;
  scoreFactors: TierScoreFactor[];
  notes: string;
  coApplicantApplied: boolean;
};

const TIER_ORDER: UnderwritingTier[] = ["BHPH", "D", "C", "B", "A"];

export const TIER_CAP_CONFIG = {
  recentPublicRecordMonths: 24,
  cleanRebuildMinTradelines: 3,
  cleanRebuildMinOpenTradelines: 1,
  thinFileMaxTier: "B",
  thinFileMaxTradelines: 2,
  noAutoWeakDepthMaxTier: "B",
  noAutoWeakDepthMaxTradelines: 3,
  recentPublicRecordMaxTier: "B",
  oldPublicRecordDirtyRebuildMaxTier: "B",
  postPublicRecordDerogMaxTier: "C",
  heavyCollectionsChargeoffsMaxTier: "C",
  heavyCollectionsCount: 3,
  heavyChargeoffsCount: 2,
  heavyPastDueAmount: 2000,
  openAutoDerogMaxTier: "C",
} as const satisfies Record<string, number | UnderwritingTier>;

export const BEHAVIOR_MODIFIER_CONFIG = {
  recentPublicRecordPenalty: -1,
  recentCleanRebuildCredit: 0.5,
  oldPublicRecordPenalty: -0.5,
  oldCleanRebuildCredit: 0.5,
  postPublicRecordDerogPenalty: -1,
  repeatedCurrentDerogPenalty: -0.5,
  repeatedCurrentDerogMinCount: 2,
  cleanCurrentTradesBonus: 0.5,
  cleanCurrentTradesMinOpenTradelines: 2,
} as const;

export const JOB_STABILITY_CONFIG = {
  strongMinMonths: 24,
  moderateMinMonths: 12,
  shortMinMonths: 6,
  strongBonus: 0.5,
  moderateBonus: 0.25,
  shortBonus: 0,
  underSixPenalty: -0.5,
} as const;

function clampTierIndex(idx: number): number {
  return Math.max(0, Math.min(TIER_ORDER.length - 1, idx));
}

function moveTier(start: UnderwritingTier, delta: number): UnderwritingTier {
  const startIdx = TIER_ORDER.indexOf(start);
  return TIER_ORDER[clampTierIndex(startIdx + delta)];
}

function tierRank(tier: UnderwritingTier): number {
  return TIER_ORDER.indexOf(tier);
}

function applyMaxTier(tier: UnderwritingTier, maxTier: UnderwritingTier): UnderwritingTier {
  return tierRank(tier) > tierRank(maxTier) ? maxTier : tier;
}

function roundHalfStep(value: number): number {
  return Math.round(value * 2) / 2;
}

function normalizeAddressPart(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}

function normalizedAddressKey(address: TierApplicantAddress | null): string | null {
  if (!address) return null;
  const parts = [
    normalizeAddressPart(address.addressLine1),
    normalizeAddressPart(address.city),
    normalizeAddressPart(address.state),
    normalizeAddressPart(address.zip),
  ];

  return parts.every(Boolean) ? parts.join("|") : null;
}

function addressesMatch(
  primaryAddress: TierApplicantAddress | null,
  coApplicantAddress: TierApplicantAddress | null
): boolean {
  const primaryKey = normalizedAddressKey(primaryAddress);
  const coApplicantKey = normalizedAddressKey(coApplicantAddress);
  return Boolean(primaryKey && coApplicantKey && primaryKey === coApplicantKey);
}

function calculateApplicantMovement(applicant: TierApplicantInput) {
  let movement = 0;
  const scoreFactors: TierScoreFactor[] = [];

  if (applicant.paidAutoTrades >= 2) {
    movement += 1.5;
    scoreFactors.push({
      code: "PAID_AUTOS_2_PLUS",
      points: 1.5,
      note: "2+ paid auto trades",
    });
  } else if (applicant.paidAutoTrades === 1) {
    movement += 1;
    scoreFactors.push({ code: "PAID_AUTOS_1", points: 1, note: "1 paid auto trade" });
  }

  if (applicant.openAutoTrades === 0 && applicant.paidAutoTrades === 0) {
    movement -= 1;
    scoreFactors.push({ code: "NO_AUTO_HISTORY", points: -1, note: "No auto history" });
  } else if (applicant.openAutoTrades > 0) {
    scoreFactors.push({
      code: "OPEN_AUTO_PRESENT",
      points: 0,
      note: "Open auto present; neutral in v1",
    });
  }

  if ((applicant.residenceMonths ?? 0) > 24) {
    movement += 1;
    scoreFactors.push({ code: "RES_OVER_24", points: 1, note: "Residence over 24 months" });
  } else if ((applicant.residenceMonths ?? 0) >= 12) {
    movement += 0.5;
    scoreFactors.push({ code: "RES_12_24", points: 0.5, note: "Residence 12-24 months" });
  } else if ((applicant.residenceMonths ?? 0) < 6) {
    movement -= 1;
    scoreFactors.push({ code: "RES_UNDER_6", points: -1, note: "Residence under 6 months" });
  }

  return {
    movement,
    scoreFactors,
  };
}

function countOrNull(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? null
    : Number(value);
}

function monthsSinceDate(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime()) return null;

  let months = (now.getFullYear() - parsed.getFullYear()) * 12;
  months += now.getMonth() - parsed.getMonth();
  if (now.getDate() < parsed.getDate()) months -= 1;
  return Math.max(0, months);
}

function calculateJobStabilityMovement(applicant: TierApplicantInput) {
  const tenureMonths = monthsSinceDate(applicant.hireDate);

  if (tenureMonths === null) {
    return {
      movement: 0,
      scoreFactors: [
        {
          code: "job_stability_unknown",
          points: 0,
          note: "Job tenure was not scored because hire date is unknown.",
        },
      ] satisfies TierScoreFactor[],
    };
  }

  if (tenureMonths >= JOB_STABILITY_CONFIG.strongMinMonths) {
    return {
      movement: JOB_STABILITY_CONFIG.strongBonus,
      scoreFactors: [
        {
          code: "job_stability_strong",
          points: JOB_STABILITY_CONFIG.strongBonus,
          note: "Job tenure is 24+ months.",
        },
      ],
    };
  }

  if (tenureMonths >= JOB_STABILITY_CONFIG.moderateMinMonths) {
    return {
      movement: JOB_STABILITY_CONFIG.moderateBonus,
      scoreFactors: [
        {
          code: "job_stability_moderate",
          points: JOB_STABILITY_CONFIG.moderateBonus,
          note: "Job tenure is 12-23 months.",
        },
      ],
    };
  }

  if (tenureMonths >= JOB_STABILITY_CONFIG.shortMinMonths) {
    return {
      movement: JOB_STABILITY_CONFIG.shortBonus,
      scoreFactors: [
        {
          code: "job_stability_short",
          points: JOB_STABILITY_CONFIG.shortBonus,
          note: "Job tenure is 6-11 months.",
        },
      ],
    };
  }

  return {
    movement: JOB_STABILITY_CONFIG.underSixPenalty,
    scoreFactors: [
      {
        code: "job_stability_short",
        points: JOB_STABILITY_CONFIG.underSixPenalty,
        note: "Job tenure is under 6 months.",
      },
    ],
  };
}

function hasHeavyCollectionsOrChargeoffs(applicant: TierApplicantInput): boolean {
  const collections = countOrNull(applicant.unresolvedCollectionsCount);
  const chargeoffs = countOrNull(applicant.unresolvedChargeoffsCount);
  const pastDue = countOrNull(applicant.pastDueAmount);

  return (
    (collections !== null && collections >= TIER_CAP_CONFIG.heavyCollectionsCount) ||
    (chargeoffs !== null && chargeoffs >= TIER_CAP_CONFIG.heavyChargeoffsCount) ||
    (pastDue !== null && pastDue >= TIER_CAP_CONFIG.heavyPastDueAmount)
  );
}

function currentDerogCount(applicant: TierApplicantInput): number {
  return (
    (countOrNull(applicant.unresolvedCollectionsCount) ?? 0) +
    (countOrNull(applicant.unresolvedChargeoffsCount) ?? 0)
  );
}

function hasOpenAutoDerog(applicant: TierApplicantInput): boolean {
  return applicant.openAutoDerogatory === true || applicant.autoDeficiency === true;
}

function hasThinFile(applicant: TierApplicantInput): boolean {
  const totalTradelines = countOrNull(applicant.totalTradelines);
  // Missing trade depth is treated as unknown, not thin. This preserves legacy
  // scoring for callers that have not yet supplied bureau depth fields.
  return totalTradelines !== null && totalTradelines <= TIER_CAP_CONFIG.thinFileMaxTradelines;
}

function hasNoAutoWeakDepth(applicant: TierApplicantInput): boolean {
  const totalTradelines = countOrNull(applicant.totalTradelines);
  const autosOnBureau = countOrNull(applicant.autosOnBureau);

  // If depth/autos are absent, do not infer a cap. Older bureau rows may not
  // have the summary fields populated even though the applicant has history.
  return (
    autosOnBureau !== null &&
    autosOnBureau === 0 &&
    applicant.openAutoTrades === 0 &&
    applicant.paidAutoTrades === 0 &&
    totalTradelines !== null &&
    totalTradelines <= TIER_CAP_CONFIG.noAutoWeakDepthMaxTradelines
  );
}

function hasCleanRebuildAfterPublicRecord(applicant: TierApplicantInput): boolean {
  const totalTradelines = countOrNull(applicant.totalTradelines);
  const openTradelines = countOrNull(applicant.openTradelines);

  return (
    !hasHeavyCollectionsOrChargeoffs(applicant) &&
    !hasOpenAutoDerog(applicant) &&
    applicant.majorDerogAfterPublicRecord !== true &&
    totalTradelines !== null &&
    totalTradelines >= TIER_CAP_CONFIG.cleanRebuildMinTradelines &&
    openTradelines !== null &&
    openTradelines >= TIER_CAP_CONFIG.cleanRebuildMinOpenTradelines
  );
}

function hasPublicRecord(applicant: TierApplicantInput): boolean {
  return (
    countOrNull(applicant.monthsSinceBankruptcy) !== null ||
    (countOrNull(applicant.bankruptcyCount) ?? 0) > 0 ||
    (countOrNull(applicant.publicRecordCount) ?? 0) > 0
  );
}

function hasCleanCurrentTrades(applicant: TierApplicantInput): boolean {
  const openTradelines = countOrNull(applicant.openTradelines);
  const pastDue = countOrNull(applicant.pastDueAmount);

  // Missing current-trade fields are unknown, not clean. This keeps older
  // bureau rows from receiving behavior credits based on absent parser data.
  return (
    openTradelines !== null &&
    openTradelines >= BEHAVIOR_MODIFIER_CONFIG.cleanCurrentTradesMinOpenTradelines &&
    currentDerogCount(applicant) === 0 &&
    (pastDue === null || pastDue <= 0) &&
    !hasOpenAutoDerog(applicant) &&
    applicant.majorDerogAfterPublicRecord !== true
  );
}

function hasCleanBehaviorAfterPublicRecord(applicant: TierApplicantInput): boolean {
  return hasCleanRebuildAfterPublicRecord(applicant) && hasCleanCurrentTrades(applicant);
}

function calculateBehaviorModifiers(applicant: TierApplicantInput) {
  let movement = 0;
  const scoreFactors: TierScoreFactor[] = [];
  const monthsSincePublicRecord = countOrNull(applicant.monthsSinceBankruptcy);
  const applicantHasPublicRecord = hasPublicRecord(applicant);
  const cleanRebuild = applicantHasPublicRecord && hasCleanBehaviorAfterPublicRecord(applicant);

  if (
    monthsSincePublicRecord !== null &&
    monthsSincePublicRecord <= TIER_CAP_CONFIG.recentPublicRecordMonths
  ) {
    movement += BEHAVIOR_MODIFIER_CONFIG.recentPublicRecordPenalty;
    scoreFactors.push({
      code: "bankruptcy_recent",
      points: BEHAVIOR_MODIFIER_CONFIG.recentPublicRecordPenalty,
      note: "Recent bankruptcy/public record worsens tier movement.",
    });

    if (cleanRebuild) {
      movement += BEHAVIOR_MODIFIER_CONFIG.recentCleanRebuildCredit;
      scoreFactors.push({
        code: "post_derog_clean_rebuild",
        points: BEHAVIOR_MODIFIER_CONFIG.recentCleanRebuildCredit,
        note: "Clean rebuild after recent bankruptcy/public record softens the behavior penalty.",
      });
    } else {
      scoreFactors.push({
        code: "post_derog_dirty_rebuild",
        points: 0,
        note: "Bankruptcy/public record rebuild is not clean enough for behavior credit.",
      });
    }
  } else if (monthsSincePublicRecord !== null && applicantHasPublicRecord) {
    movement += BEHAVIOR_MODIFIER_CONFIG.oldPublicRecordPenalty;
    scoreFactors.push({
      code: "bankruptcy_old",
      points: BEHAVIOR_MODIFIER_CONFIG.oldPublicRecordPenalty,
      note: "Older bankruptcy/public record modestly worsens tier movement.",
    });

    if (cleanRebuild) {
      movement += BEHAVIOR_MODIFIER_CONFIG.oldCleanRebuildCredit;
      scoreFactors.push({
        code: "post_derog_clean_rebuild",
        points: BEHAVIOR_MODIFIER_CONFIG.oldCleanRebuildCredit,
        note: "Clean rebuild after older bankruptcy/public record reduces the behavior penalty.",
      });
    } else {
      scoreFactors.push({
        code: "post_derog_dirty_rebuild",
        points: 0,
        note: "Older bankruptcy/public record rebuild is not clean enough for behavior credit.",
      });
    }
  }

  if (applicantHasPublicRecord && applicant.majorDerogAfterPublicRecord === true) {
    movement += BEHAVIOR_MODIFIER_CONFIG.postPublicRecordDerogPenalty;
    scoreFactors.push({
      code: "derog_after_bankruptcy",
      points: BEHAVIOR_MODIFIER_CONFIG.postPublicRecordDerogPenalty,
      note: "Major derogatory activity after bankruptcy/public record worsens tier movement.",
    });
  }

  if (
    !applicantHasPublicRecord &&
    (currentDerogCount(applicant) >= BEHAVIOR_MODIFIER_CONFIG.repeatedCurrentDerogMinCount ||
      hasOpenAutoDerog(applicant))
  ) {
    movement += BEHAVIOR_MODIFIER_CONFIG.repeatedCurrentDerogPenalty;
    scoreFactors.push({
      code: "repeated_current_derog",
      points: BEHAVIOR_MODIFIER_CONFIG.repeatedCurrentDerogPenalty,
      note: "Repeated current derogatory behavior modestly worsens tier movement.",
    });
  }

  if (hasCleanCurrentTrades(applicant)) {
    movement += BEHAVIOR_MODIFIER_CONFIG.cleanCurrentTradesBonus;
    scoreFactors.push({
      code: "clean_current_trades",
      points: BEHAVIOR_MODIFIER_CONFIG.cleanCurrentTradesBonus,
      note: "Clean active/open tradelines modestly improve tier movement.",
    });
  }

  return {
    movement,
    scoreFactors,
  };
}

function getTierCapFactors(applicant: TierApplicantInput): TierScoreFactor[] {
  const factors: TierScoreFactor[] = [];
  const monthsSincePublicRecord = countOrNull(applicant.monthsSinceBankruptcy);
  const applicantHasPublicRecord = hasPublicRecord(applicant);

  if (
    monthsSincePublicRecord !== null &&
    monthsSincePublicRecord <= TIER_CAP_CONFIG.recentPublicRecordMonths
  ) {
    factors.push({
      code: "tier_cap_recent_bankruptcy",
      points: 0,
      note: "Recent bankruptcy/public record limits maximum tier to B.",
    });
  } else if (
    monthsSincePublicRecord !== null &&
    applicantHasPublicRecord &&
    !hasCleanRebuildAfterPublicRecord(applicant)
  ) {
    factors.push({
      code: "tier_cap_old_bankruptcy_dirty_rebuild",
      points: 0,
      note: "Older bankruptcy/public record without a clean rebuild limits maximum tier to B.",
    });
  }

  if (applicantHasPublicRecord && applicant.majorDerogAfterPublicRecord === true) {
    factors.push({
      code: "tier_cap_post_bankruptcy_derog",
      points: 0,
      note: "Major derogatory activity after bankruptcy/public record limits maximum tier to C.",
    });
  }

  if (hasHeavyCollectionsOrChargeoffs(applicant)) {
    factors.push({
      code: "tier_cap_heavy_collections_chargeoffs",
      points: 0,
      note: "Heavy unresolved collections/chargeoffs limit maximum tier to C.",
    });
  }

  if (hasOpenAutoDerog(applicant)) {
    factors.push({
      code: "tier_cap_open_auto_derog",
      points: 0,
      note: "Open auto derogatory or auto deficiency limits maximum tier to C.",
    });
  }

  if (hasThinFile(applicant)) {
    factors.push({
      code: "tier_cap_thin_file",
      points: 0,
      note: "Thin bureau file cannot receive an A tier.",
    });
  }

  if (hasNoAutoWeakDepth(applicant)) {
    factors.push({
      code: "tier_cap_no_auto_weak_depth",
      points: 0,
      note: "No prior auto history with weak trade depth cannot receive an A tier.",
    });
  }

  return factors;
}

function applyTierCaps(tier: UnderwritingTier, factors: TierScoreFactor[]): UnderwritingTier {
  return factors.reduce((currentTier, factor) => {
    switch (factor.code) {
      case "tier_cap_post_bankruptcy_derog":
      case "tier_cap_heavy_collections_chargeoffs":
      case "tier_cap_open_auto_derog":
        return applyMaxTier(currentTier, "C");
      case "tier_cap_recent_bankruptcy":
      case "tier_cap_old_bankruptcy_dirty_rebuild":
      case "tier_cap_thin_file":
      case "tier_cap_no_auto_weak_depth":
        return applyMaxTier(currentTier, "B");
      default:
        return currentTier;
    }
  }, tier);
}

function getCoApplicantSkipFactors(args: ScoreDealTierArgs): TierScoreFactor[] {
  const factors: TierScoreFactor[] = [];
  const context = args.coApplicantContext;

  if (!args.primary) {
    factors.push({
      code: "coapp_skipped_no_primary_bureau",
      points: 0,
      note: "Co-app bureau was not used because no primary bureau is available.",
    });
  }

  if (!args.coApplicant) {
    factors.push({
      code: "coapp_skipped_no_bureau",
      points: 0,
      note: "Co-app bureau was not used because no co-app bureau is available.",
    });
  }

  if (!context?.householdIncome) {
    factors.push({
      code: "coapp_skipped_household_income_off",
      points: 0,
      note: "Co-app bureau was not used because household income is off.",
    });
  }

  if (!context?.hasAppliedIncome) {
    factors.push({
      code: "coapp_skipped_no_applied_income",
      points: 0,
      note: "Co-app bureau was not used because no co-app income is applied.",
    });
  }

  if (!addressesMatch(context?.primaryAddress ?? null, context?.coApplicantAddress ?? null)) {
    factors.push({
      code: "coapp_skipped_residence_mismatch",
      points: 0,
      note: "Co-app bureau was not used because residence address does not match primary.",
    });
  }

  return factors;
}

export function scoreDealTier(args: ScoreDealTierArgs): ScoreDealTierResult {
  if (!args.primary) {
    return {
      decision: "denied",
      tier: null,
      scoreTotal: 0,
      hardStop: true,
      hardStopReason: "No primary bureau found",
      scoreFactors: getCoApplicantSkipFactors(args),
      notes: "Hard stop: primary bureau is required before underwriting tier can be scored.",
      coApplicantApplied: false,
    };
  }

  if ((args.primary.score ?? 999) < 420) {
    return {
      decision: "denied",
      tier: null,
      scoreTotal: 0,
      hardStop: true,
      hardStopReason: "Score below 420",
      scoreFactors: getCoApplicantSkipFactors(args),
      notes: "Hard stop: bureau score below minimum threshold.",
      coApplicantApplied: false,
    };
  }

  if (
    args.primary.repoCount > 1 &&
    args.primary.monthsSinceRepo !== null &&
    args.primary.monthsSinceRepo < 12
  ) {
    return {
      decision: "denied",
      tier: null,
      scoreTotal: 0,
      hardStop: true,
      hardStopReason: "More than 1 repo within last 12 months",
      scoreFactors: getCoApplicantSkipFactors(args),
      notes: "Hard stop: excessive recent repos.",
      coApplicantApplied: false,
    };
  }

  const primaryScoring = calculateApplicantMovement(args.primary);
  const primaryBehavior = calculateBehaviorModifiers(args.primary);
  const primaryJobStability = calculateJobStabilityMovement(args.primary);
  const skipFactors = getCoApplicantSkipFactors(args);
  const coApplicantIsValid = skipFactors.length === 0 && Boolean(args.coApplicant);
  let movement = primaryScoring.movement;
  let behaviorMovement = primaryBehavior.movement;
  let jobStabilityMovement = primaryJobStability.movement;
  const scoreFactors = [...primaryScoring.scoreFactors, ...skipFactors];

  if (coApplicantIsValid && args.coApplicant) {
    const coScoring = calculateApplicantMovement(args.coApplicant);
    const coBehavior = calculateBehaviorModifiers(args.coApplicant);
    const coJobStability = calculateJobStabilityMovement(args.coApplicant);
    movement = primaryScoring.movement * 0.7 + coScoring.movement * 0.3;
    behaviorMovement = primaryBehavior.movement * 0.7 + coBehavior.movement * 0.3;
    jobStabilityMovement =
      primaryJobStability.movement * 0.7 + coJobStability.movement * 0.3;
    scoreFactors.push(...coScoring.scoreFactors);
    scoreFactors.push({
      code: "coapp_weighting_applied",
      points: roundHalfStep(movement),
      note: "Co-app bureau was included with 70% primary / 30% co-app weighting.",
    });
    scoreFactors.push(...primaryBehavior.scoreFactors, ...coBehavior.scoreFactors);
    scoreFactors.push(
      ...primaryJobStability.scoreFactors,
      ...coJobStability.scoreFactors
    );
  } else {
    scoreFactors.push(...primaryBehavior.scoreFactors);
    scoreFactors.push(...primaryJobStability.scoreFactors);
  }

  const behaviorAdjustedMovement = movement + behaviorMovement + jobStabilityMovement;
  const cappedMovement = Math.max(-2, Math.min(2, roundHalfStep(behaviorAdjustedMovement)));
  const rawTier = moveTier("C", Math.trunc(cappedMovement));
  const capFactors = [
    ...getTierCapFactors(args.primary),
    ...(coApplicantIsValid && args.coApplicant ? getTierCapFactors(args.coApplicant) : []),
  ];
  const tier = applyTierCaps(rawTier, capFactors);
  scoreFactors.push(...capFactors);

  return {
    decision: "approved",
    tier,
    scoreTotal: cappedMovement,
    hardStop: false,
    hardStopReason: null,
    scoreFactors,
    notes: `Started at Tier C. Raw movement: ${movement}. Behavior movement: ${behaviorMovement}. Job stability movement: ${jobStabilityMovement}. Capped movement: ${cappedMovement}. Raw tier: ${rawTier}. Final tier: ${tier}.`,
    coApplicantApplied: coApplicantIsValid,
  };
}
