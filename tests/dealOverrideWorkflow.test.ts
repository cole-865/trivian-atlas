import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDealOverrideFingerprint,
  normalizeDealOverrideStructureSnapshot,
} from "../src/lib/deals/dealOverrideFingerprint.js";
import {
  buildOverrideStructureSnapshot,
  canRequestOverrideForBlockerState,
  evaluateDealOverrides,
  getStaleReasonForRequest,
} from "../src/lib/deals/dealOverrideWorkflow.js";
import {
  buildDealOverrideRequestNote,
  getDealOverrideRouteToFixAmount,
} from "../src/lib/deals/dealOverrideSummary.js";

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

test("blocked and stale blockers can request a new override", () => {
  assert.equal(canRequestOverrideForBlockerState("blocked"), true);
  assert.equal(canRequestOverrideForBlockerState("stale"), true);
  assert.equal(canRequestOverrideForBlockerState("pending"), false);
  assert.equal(canRequestOverrideForBlockerState("overridden"), false);
});

test("override request note includes the required structured details", () => {
  const note = buildDealOverrideRequestNote({
    blockerCode: "LTV",
    customerName: "Pat Jones",
    snapshot: {
      assumptions: {
        max_amount_financed: 18000,
        max_ltv: 1.3,
        max_payment_cap: 504,
        max_vehicle_price: 18000,
        tier: "C",
      },
      structure: {
        additional_down_needed: 840.29,
        additional_down_breakdown: {
          ltv: 840.29,
        },
        amount_financed: 9680.29,
        cash_down_effective: 2000,
        ltv: 1.42,
        monthly_payment: 457.33,
        sale_price: 9997,
        term_months: 30,
      },
      vehicle: {
        stock_number: "118412R1",
        year: 2011,
        make: "BUICK",
        model: "REGAL",
        odometer: 159000,
      },
    },
    userNote: "Customer can bring in the remaining down payment tomorrow.",
  });

  assert.match(note, /Stk Number: 118412R1/);
  assert.match(note, /Customer Name: Pat Jones/);
  assert.match(note, /Vehicle: 2011 BUICK REGAL/);
  assert.match(note, /Odo: 159,000/);
  assert.match(note, /Tier: C/);
  assert.match(note, /Blocking Issue: LTV too high/);
  assert.match(note, /Vehicle Price: \$9,997\.00 vs \$18,000\.00 max/);
  assert.match(note, /Amount Financed: \$9,680\.29 vs \$18,000\.00 max/);
  assert.match(note, /Monthly Payment: \$457\.33 vs \$504\.00 cap/);
  assert.match(note, /Cash Down Used: \$2,000\.00/);
  assert.match(note, /Additional Down Needed: \$840\.29/);
  assert.match(note, /LTV: 142\.0% vs 130\.0% max/);
  assert.match(note, /Route to Fix Issue: \$840\.29/);
  assert.match(note, /Term: 30 months/);
  assert.match(
    note,
    /Reason for Exception:\nCustomer can bring in the remaining down payment tomorrow\./
  );
});

test("route to fix issue uses the blocker-specific amount", () => {
  const snapshot = {
    assumptions: {
      max_vehicle_price: 9000,
    },
    structure: {
      additional_down_breakdown: {
        amount_financed: 500,
        ltv: 840.29,
        min_down: 250,
        pti: 120.45,
      },
      amount_financed: 9680.29,
      sale_price: 9997,
    },
  };

  assert.equal(
    getDealOverrideRouteToFixAmount({ blockerCode: "AMOUNT_FINANCED", snapshot }),
    500
  );
  assert.equal(
    getDealOverrideRouteToFixAmount({ blockerCode: "LTV", snapshot }),
    840.29
  );
  assert.equal(
    getDealOverrideRouteToFixAmount({ blockerCode: "PTI", snapshot }),
    120.45
  );
  assert.equal(
    getDealOverrideRouteToFixAmount({ blockerCode: "VEHICLE_PRICE", snapshot }),
    997
  );
});
