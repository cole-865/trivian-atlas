import {
  buildDealOverrideFingerprint,
  type DealOverrideBlockerCode,
  type DealOverrideStructureSnapshot,
} from "./dealOverrideFingerprint";

export type DealOverrideRequestStatus =
  | "pending"
  | "approved"
  | "denied"
  | "cancelled"
  | "stale";

export type DealOverrideRequestLike = {
  blockerCode: DealOverrideBlockerCode;
  status: DealOverrideRequestStatus;
  structureFingerprint: string;
  vehicleId: string | null;
  staleReason: string | null;
  requestedAt: string;
};

export type DealOverrideBlockerState =
  | "blocked"
  | "pending"
  | "overridden"
  | "stale";

export type DealOverrideEvaluation = {
  currentFingerprint: string;
  rawBlockers: DealOverrideBlockerCode[];
  effectiveBlockers: DealOverrideBlockerCode[];
  validApprovedRequests: DealOverrideRequestLike[];
  staleCandidates: Array<DealOverrideRequestLike & { staleReason: string }>;
  blockerStates: Array<{
    blockerCode: DealOverrideBlockerCode;
    state: DealOverrideBlockerState;
    request: DealOverrideRequestLike | null;
    staleReason: string | null;
  }>;
};

export const DEAL_OVERRIDE_BLOCKER_CODES: DealOverrideBlockerCode[] = [
  "AMOUNT_FINANCED",
  "LTV",
  "PTI",
  "VEHICLE_PRICE",
];

export function normalizeDealOverrideBlockerCode(
  value: string | null | undefined
): DealOverrideBlockerCode | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return DEAL_OVERRIDE_BLOCKER_CODES.includes(
    normalized as DealOverrideBlockerCode
  )
    ? (normalized as DealOverrideBlockerCode)
    : null;
}

export function extractCurrentBlockers(
  failReasons: unknown
): DealOverrideBlockerCode[] {
  if (!Array.isArray(failReasons)) {
    return [];
  }

  return Array.from(
    new Set(
      failReasons
        .map((reason) =>
          normalizeDealOverrideBlockerCode(String(reason ?? ""))
        )
        .filter((reason): reason is DealOverrideBlockerCode => !!reason)
    )
  );
}

export function getStaleReasonForRequest(args: {
  request: DealOverrideRequestLike;
  currentFingerprint: string;
  liveVehicleId: string | null;
}) {
  const liveVehicleId = args.liveVehicleId?.trim() || null;
  const requestVehicleId = args.request.vehicleId?.trim() || null;

  if (liveVehicleId !== requestVehicleId) {
    return "Selected vehicle changed after override approval.";
  }

  if (args.request.structureFingerprint !== args.currentFingerprint) {
    return "Deal structure changed after override approval.";
  }

  return null;
}

export function isApprovedOverrideValid(args: {
  request: DealOverrideRequestLike;
  currentFingerprint: string;
  liveVehicleId: string | null;
}) {
  return (
    args.request.status === "approved" &&
    !getStaleReasonForRequest(args)
  );
}

function getLatestRequestForBlocker(
  requests: DealOverrideRequestLike[],
  blockerCode: DealOverrideBlockerCode
) {
  return requests
    .filter((request) => request.blockerCode === blockerCode)
    .sort(
      (a, b) =>
        new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    )[0] ?? null;
}

export function evaluateDealOverrides(args: {
  liveStructure: DealOverrideStructureSnapshot;
  failReasons: unknown;
  requests: DealOverrideRequestLike[];
}): DealOverrideEvaluation {
  const currentFingerprint = buildDealOverrideFingerprint(args.liveStructure);
  const rawBlockers = extractCurrentBlockers(args.failReasons);
  const liveVehicleId = args.liveStructure.vehicleId?.trim() || null;

  const validApprovedRequests = args.requests.filter((request) =>
    isApprovedOverrideValid({
      request,
      currentFingerprint,
      liveVehicleId,
    })
  );

  const staleCandidates = args.requests
    .filter((request) => request.status === "approved")
    .map((request) => ({
      request,
      staleReason: getStaleReasonForRequest({
        request,
        currentFingerprint,
        liveVehicleId,
      }),
    }))
    .filter(
      (
        candidate
      ): candidate is {
        request: DealOverrideRequestLike;
        staleReason: string;
      } => !!candidate.staleReason
    )
    .map((candidate) => ({
      ...candidate.request,
      staleReason: candidate.staleReason,
    }));

  const approvedCodes = new Set(
    validApprovedRequests.map((request) => request.blockerCode)
  );

  const effectiveBlockers = rawBlockers.filter(
    (blockerCode) => !approvedCodes.has(blockerCode)
  );

  const blockerStates = rawBlockers.map((blockerCode) => {
    const matchingPending =
      args.requests.find(
        (request) =>
          request.blockerCode === blockerCode &&
          request.status === "pending" &&
          request.structureFingerprint === currentFingerprint
      ) ?? null;

    const matchingApproved =
      validApprovedRequests.find(
        (request) => request.blockerCode === blockerCode
      ) ?? null;

    const latestRequest = getLatestRequestForBlocker(args.requests, blockerCode);
    const staleCandidate =
      staleCandidates.find((request) => request.blockerCode === blockerCode) ??
      null;

    if (matchingApproved) {
      return {
        blockerCode,
        state: "overridden" as const,
        request: matchingApproved,
        staleReason: null,
      };
    }

    if (matchingPending) {
      return {
        blockerCode,
        state: "pending" as const,
        request: matchingPending,
        staleReason: null,
      };
    }

    if (latestRequest?.status === "stale" || staleCandidate) {
      return {
        blockerCode,
        state: "stale" as const,
        request: latestRequest ?? staleCandidate,
        staleReason:
          latestRequest?.staleReason ?? staleCandidate?.staleReason ?? null,
      };
    }

    return {
      blockerCode,
      state: "blocked" as const,
      request: latestRequest,
      staleReason: null,
    };
  });

  return {
    currentFingerprint,
    rawBlockers,
    effectiveBlockers,
    validApprovedRequests,
    staleCandidates,
    blockerStates,
  };
}

export function buildOverrideStructureSnapshot(args: {
  vehicleId: string | null | undefined;
  cashDown: number | null | undefined;
  amountFinanced: number | null | undefined;
  monthlyPayment: number | null | undefined;
  termMonths: number | null | undefined;
  ltv: number | null | undefined;
  pti: number | null | undefined;
}) {
  return {
    vehicleId: args.vehicleId ?? null,
    cashDown: args.cashDown ?? null,
    amountFinanced: args.amountFinanced ?? null,
    monthlyPayment: args.monthlyPayment ?? null,
    termMonths: args.termMonths ?? null,
    ltv: args.ltv ?? null,
    pti: args.pti ?? null,
  } satisfies DealOverrideStructureSnapshot;
}

export function hasUnresolvedEffectiveBlockers(args: {
  liveStructure: DealOverrideStructureSnapshot;
  failReasons: unknown;
  requests: DealOverrideRequestLike[];
}) {
  return (
    evaluateDealOverrides(args).effectiveBlockers.length > 0
  );
}
