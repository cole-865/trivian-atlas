import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDecisionAssistReview,
  type DecisionAssistVehicleOptionComparison,
  type DecisionAssistVehicleOptionScenario,
} from "../src/lib/deals/dealDecisionAssist.js";
import type { DealStructureComputedState } from "../src/lib/deals/dealStructureEngine.js";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function makeComputed(
  overrides: DeepPartial<DealStructureComputedState> = {}
): DealStructureComputedState {
  const base: DealStructureComputedState = {
    assumptions: {
      tier: "C",
      max_payment_cap: 500,
      max_amount_financed: 18000,
      max_vehicle_price: 18000,
      max_ltv: 1.3,
      max_pti: 0.22,
      trade_payoff: 0,
      underwriting_max_term_months: 60,
      vehicle_max_term_months: 60,
      vehicle_base_term_months: 54,
    },
    structure: {
      sale_price: 16000,
      cash_down_input: 1500,
      cash_down_effective: 1500,
      required_down: 1500,
      additional_down_needed: 0,
      taxable_amount: 16000,
      sales_tax: 1120,
      doc_fee: 895,
      title_license: 250,
      fees_total: 2265,
      product_total: 0,
      vsc_price: 0,
      gap_price: 0,
      amount_financed: 16765,
      apr: 28.99,
      term_months: 54,
      monthly_payment: 490,
      ltv: 1.24,
      pti: 0.21,
      fits_program: true,
      fail_reasons: [],
      checks: {
        vehicle_price_ok: true,
        amount_financed_ok: true,
        ltv_ok: true,
        payment_ok: true,
      },
      additional_down_breakdown: {
        min_down: 0,
        amount_financed: 0,
        ltv: 0,
        pti: 0,
      },
    },
    vehicle: {
      id: "veh-1",
      stock_number: "1001",
      vin: "VIN-1",
      year: 2016,
      make: "Ford",
      model: "Escape",
      odometer: 82000,
      status: "IN INVENTORY",
      date_in_stock: "2026-04-01",
      asking_price: 16000,
      jd_power_retail_book: 13500,
      vehicle_category: "suv",
      vehicle_age_years: 10,
      vehicle_policy_max_term_months: 60,
      vehicle_term_policy_note: null,
    },
    selection: {
      vehicle_id: "veh-1",
      option_label: "NONE",
      include_vsc: false,
      include_gap: false,
    },
  };

  return {
    ...base,
    assumptions: {
      ...base.assumptions,
      ...(overrides.assumptions ?? {}),
    },
    structure: {
      ...base.structure,
      ...(overrides.structure ?? {}),
      checks: {
        ...base.structure.checks,
        ...(overrides.structure?.checks ?? {}),
      },
      additional_down_breakdown: {
        ...base.structure.additional_down_breakdown,
        ...(overrides.structure?.additional_down_breakdown ?? {}),
      },
      fail_reasons: [
        ...((overrides.structure?.fail_reasons as string[] | undefined) ??
          base.structure.fail_reasons),
      ],
    },
    vehicle: {
      ...base.vehicle,
      ...(overrides.vehicle ?? {}),
    },
    selection: {
      ...base.selection,
      ...(overrides.selection ?? {}),
    },
  };
}

function makeScenario(
  computed: DealStructureComputedState
): DecisionAssistVehicleOptionScenario {
  return {
    label: computed.selection.option_label,
    include_vsc: computed.selection.include_vsc,
    include_gap: computed.selection.include_gap,
    computed,
  };
}

function makeVehicleRow(
  vehicleId: string,
  scenarios: DealStructureComputedState[]
): DecisionAssistVehicleOptionComparison {
  return {
    vehicle: scenarios[0].vehicle,
    scenarios: scenarios.map((scenario) => ({
      ...makeScenario(scenario),
      computed: {
        ...scenario,
        vehicle: {
          ...scenario.vehicle,
          id: vehicleId,
        },
      },
    })),
  };
}

const noOverrides = {
  currentFingerprint: "fp",
  rawBlockers: [] as string[],
  effectiveBlockers: [] as string[],
  requests: [] as Array<{ id: string; blocker_code: string; status: string }>,
};

const overrideTriggered = {
  ...noOverrides,
  requests: [{ id: "req-1", blocker_code: "PTI", status: "pending" }],
};

test("PTI failure returns increase_down_payment first with required_down", () => {
  const current = makeComputed({
    structure: {
      fits_program: false,
      fail_reasons: ["PTI"],
      monthly_payment: 545,
      additional_down_needed: 1200,
      additional_down_breakdown: {
        min_down: 0,
        amount_financed: 0,
        ltv: 0,
        pti: 1200,
      },
      checks: {
        vehicle_price_ok: true,
        amount_financed_ok: true,
        ltv_ok: true,
        payment_ok: false,
      },
    },
  });

  const review = buildDecisionAssistReview({
    underwritingDecision: "approved",
    computed: current,
    overrides: overrideTriggered,
    vehicleRows: [makeVehicleRow(current.vehicle.id, [current])],
    shorterTermScenario: null,
    longerTermScenario: null,
  });

  assert.ok(review);
  assert.equal(review.recommended_actions[0].type, "increase_down_payment");
  assert.equal(review.recommended_actions[0].estimated_values?.required_down, 2700);
});

test("LTV failure returns adjust_vehicle first with numeric estimates", () => {
  const current = makeComputed({
    structure: {
      fits_program: false,
      fail_reasons: ["LTV"],
      ltv: 1.41,
      additional_down_needed: 1800,
      additional_down_breakdown: {
        min_down: 0,
        amount_financed: 0,
        ltv: 1800,
        pti: 0,
      },
      checks: {
        vehicle_price_ok: true,
        amount_financed_ok: true,
        ltv_ok: false,
        payment_ok: true,
      },
    },
  });

  const alternative = makeComputed({
    vehicle: {
      id: "veh-2",
      stock_number: "2002",
      make: "Honda",
      model: "CR-V",
      asking_price: 14500,
      jd_power_retail_book: 14000,
    },
    structure: {
      sale_price: 14500,
      amount_financed: 15250,
      monthly_payment: 468,
      ltv: 1.09,
      fits_program: true,
      fail_reasons: [],
      additional_down_needed: 0,
    },
  });

  const review = buildDecisionAssistReview({
    underwritingDecision: "approved",
    computed: current,
    overrides: {
      ...overrideTriggered,
      requests: [{ id: "req-2", blocker_code: "LTV", status: "pending" }],
    },
    vehicleRows: [
      makeVehicleRow(current.vehicle.id, [current]),
      makeVehicleRow("veh-2", [alternative]),
    ],
    shorterTermScenario: null,
    longerTermScenario: null,
  });

  assert.ok(review);
  assert.equal(review.recommended_actions[0].type, "adjust_vehicle");
  assert.equal(review.recommended_actions[0].estimated_values?.estimated_payment, 468);
  assert.equal(review.recommended_actions[0].estimated_values?.ltv, 1.09);
});

test("multi-fail review prioritizes the highest-priority blocker first", () => {
  const current = makeComputed({
    structure: {
      fits_program: false,
      fail_reasons: ["PTI", "LTV"],
      monthly_payment: 542,
      ltv: 1.39,
      additional_down_needed: 1600,
      additional_down_breakdown: {
        min_down: 0,
        amount_financed: 0,
        ltv: 1600,
        pti: 900,
      },
      checks: {
        vehicle_price_ok: true,
        amount_financed_ok: true,
        ltv_ok: false,
        payment_ok: false,
      },
    },
  });

  const alternative = makeComputed({
    vehicle: {
      id: "veh-3",
      stock_number: "3003",
      make: "Toyota",
      model: "RAV4",
      asking_price: 14200,
      jd_power_retail_book: 13950,
    },
    structure: {
      sale_price: 14200,
      amount_financed: 14950,
      monthly_payment: 462,
      ltv: 1.07,
      fits_program: true,
      fail_reasons: [],
      additional_down_needed: 0,
    },
  });

  const review = buildDecisionAssistReview({
    underwritingDecision: "approved",
    computed: current,
    overrides: noOverrides,
    vehicleRows: [
      makeVehicleRow(current.vehicle.id, [current]),
      makeVehicleRow("veh-3", [alternative]),
    ],
    shorterTermScenario: null,
    longerTermScenario: null,
  });

  assert.ok(review);
  assert.equal(review.recommended_actions[0].type, "adjust_vehicle");
});

test("near-threshold approval returns near_approval with a quantified term recommendation", () => {
  const current = makeComputed({
    structure: {
      monthly_payment: 495,
      ltv: 1.1,
    },
  });

  const longerTerm = makeScenario(
    makeComputed({
      structure: {
        term_months: 60,
        monthly_payment: 474,
      },
    })
  );

  const review = buildDecisionAssistReview({
    underwritingDecision: "approved",
    computed: current,
    overrides: noOverrides,
    vehicleRows: [makeVehicleRow(current.vehicle.id, [current])],
    shorterTermScenario: null,
    longerTermScenario: longerTerm,
  });

  assert.ok(review);
  assert.equal(review.deal_strategy_hint, "near_approval");
  assert.equal(review.recommended_actions[0].type, "adjust_term");
  assert.equal(review.recommended_actions[0].estimated_values?.term_months, 60);
  assert.equal(review.recommended_actions[0].estimated_values?.estimated_payment, 474);
});

test("remove_products action includes quantified improvement when available", () => {
  const current = makeComputed({
    selection: {
      option_label: "VSC+GAP",
      include_vsc: true,
      include_gap: true,
    },
    structure: {
      fits_program: false,
      fail_reasons: ["PTI"],
      monthly_payment: 560,
      product_total: 2398,
      vsc_price: 1799,
      gap_price: 599,
      additional_down_needed: 1400,
      additional_down_breakdown: {
        min_down: 0,
        amount_financed: 0,
        ltv: 0,
        pti: 1400,
      },
      checks: {
        vehicle_price_ok: true,
        amount_financed_ok: true,
        ltv_ok: true,
        payment_ok: false,
      },
    },
  });

  const noProducts = makeComputed({
    structure: {
      term_months: 54,
      product_total: 0,
      vsc_price: 0,
      gap_price: 0,
      monthly_payment: 498,
      additional_down_needed: 0,
      fits_program: true,
      fail_reasons: [],
    },
  });

  const review = buildDecisionAssistReview({
    underwritingDecision: "approved",
    computed: current,
    overrides: overrideTriggered,
    vehicleRows: [
      makeVehicleRow(current.vehicle.id, [current, noProducts]),
    ],
    shorterTermScenario: null,
    longerTermScenario: null,
  });

  assert.ok(review);
  assert.ok(
    review.recommended_actions.some(
      (action) =>
        action.type === "remove_products" &&
        action.estimated_values?.estimated_payment === 498
    )
  );
});

test("no viable retail path falls back to bhph candidate", () => {
  const current = makeComputed({
    structure: {
      fits_program: false,
      fail_reasons: ["VEHICLE_PRICE"],
      sale_price: 21000,
      additional_down_needed: 0,
      checks: {
        vehicle_price_ok: false,
        amount_financed_ok: true,
        ltv_ok: true,
        payment_ok: true,
      },
    },
    assumptions: {
      max_vehicle_price: 18000,
    },
  });

  const review = buildDecisionAssistReview({
    underwritingDecision: "denied",
    computed: current,
    overrides: noOverrides,
    vehicleRows: [makeVehicleRow(current.vehicle.id, [current])],
    shorterTermScenario: null,
    longerTermScenario: null,
  });

  assert.ok(review);
  assert.equal(review.recommended_actions[0].type, "bhph_candidate");
});
