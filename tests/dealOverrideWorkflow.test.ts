import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDealOverrideFingerprint,
  normalizeDealOverrideStructureSnapshot,
} from "../src/lib/deals/dealOverrideFingerprint.js";
import {
  buildOverrideStructureSnapshot,
  evaluateDealOverrides,
  getStaleReasonForRequest,
} from "../src/lib/deals/dealOverrideWorkflow.js";

test("deal override fingerprint normalizes equivalent structure values", () => {
  const a = buildOverrideStructureSnapshot({
    vehicleId: "veh-1",
    cashDown: 1500,
    amountFinanced: 16984.219999,
    monthlyPayment: 601.599999,
    termMonths: 48,
    ltv: 1.55,
    pti: null,
  });

  const b = buildOverrideStructureSnapshot({
    vehicleId: "veh-1",
    cashDown: 1500.0,
    amountFinanced: 16984.22,
    monthlyPayment: 601.6,
    termMonths: 48,
    ltv: 1.5500001,
    pti: null,
  });

  assert.deepEqual(
    normalizeDealOverrideStructureSnapshot(a),
    normalizeDealOverrideStructureSnapshot(b)
  );
  assert.equal(buildDealOverrideFingerprint(a), buildDealOverrideFingerprint(b));
});

test("deal override fingerprint changes when the vehicle changes", () => {
  const a = buildOverrideStructureSnapshot({
    vehicleId: "veh-1",
    cashDown: 1500,
    amountFinanced: 16984.22,
    monthlyPayment: 601.6,
    termMonths: 48,
    ltv: 1.55,
    pti: null,
  });

  const b = buildOverrideStructureSnapshot({
    vehicleId: "veh-2",
    cashDown: 1500,
    amountFinanced: 16984.22,
    monthlyPayment: 601.6,
    termMonths: 48,
    ltv: 1.55,
    pti: null,
  });

  assert.notEqual(buildDealOverrideFingerprint(a), buildDealOverrideFingerprint(b));
});

test("effective blockers only subtract valid approved overrides", () => {
  const liveStructure = buildOverrideStructureSnapshot({
    vehicleId: "veh-1",
    cashDown: 1500,
    amountFinanced: 16984.22,
    monthlyPayment: 601.6,
    termMonths: 48,
    ltv: 1.55,
    pti: null,
  });

  const fingerprint = buildDealOverrideFingerprint(liveStructure);
  const evaluation = evaluateDealOverrides({
    liveStructure,
    failReasons: ["LTV", "PTI"],
    requests: [
      {
        blockerCode: "LTV",
        requestedAt: "2026-04-09T00:00:00.000Z",
        staleReason: null,
        status: "approved",
        structureFingerprint: fingerprint,
        vehicleId: "veh-1",
      },
      {
        blockerCode: "PTI",
        requestedAt: "2026-04-09T00:00:00.000Z",
        staleReason: null,
        status: "pending",
        structureFingerprint: fingerprint,
        vehicleId: "veh-1",
      },
    ],
  });

  assert.deepEqual(evaluation.rawBlockers, ["LTV", "PTI"]);
  assert.deepEqual(evaluation.effectiveBlockers, ["PTI"]);
  assert.equal(
    evaluation.blockerStates.find((state) => state.blockerCode === "LTV")?.state,
    "overridden"
  );
  assert.equal(
    evaluation.blockerStates.find((state) => state.blockerCode === "PTI")?.state,
    "pending"
  );
});

test("approved overrides become stale when the structure fingerprint no longer matches", () => {
  const oldStructure = buildOverrideStructureSnapshot({
    vehicleId: "veh-1",
    cashDown: 1500,
    amountFinanced: 16984.22,
    monthlyPayment: 601.6,
    termMonths: 48,
    ltv: 1.55,
    pti: null,
  });

  const newStructure = buildOverrideStructureSnapshot({
    vehicleId: "veh-1",
    cashDown: 2000,
    amountFinanced: 16484.22,
    monthlyPayment: 580.1,
    termMonths: 48,
    ltv: 1.49,
    pti: null,
  });

  const staleReason = getStaleReasonForRequest({
    request: {
      blockerCode: "LTV",
      requestedAt: "2026-04-09T00:00:00.000Z",
      staleReason: null,
      status: "approved",
      structureFingerprint: buildDealOverrideFingerprint(oldStructure),
      vehicleId: "veh-1",
    },
    currentFingerprint: buildDealOverrideFingerprint(newStructure),
    liveVehicleId: "veh-1",
  });

  assert.equal(staleReason, "Deal structure changed after override approval.");
});
