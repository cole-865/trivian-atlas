import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDealStructureInputFingerprint,
  computeDealStructureState,
  type DealStructureInputsRecord,
} from "../src/lib/deals/dealStructureMath.js";

function makeInputs(overrides: Partial<DealStructureInputsRecord> = {}): DealStructureInputsRecord {
  return {
    organization_id: "org-1",
    deal_id: "deal-1",
    vehicle_id: "veh-1",
    option_label: "NONE",
    include_vsc: false,
    include_gap: false,
    term_months: 30,
    cash_down: 2000,
    sale_price: 9997,
    tax_rate_main: 0.07,
    tax_add_base: 320,
    tax_add_rate: 0.07,
    doc_fee: 699,
    title_license: 196.5,
    vsc_price: 0,
    gap_price: 0,
    ...overrides,
  };
}

const baseDeal = {
  cash_down: 2000,
  customer_name: "Pat Jones",
  has_trade: false,
  id: "deal-1",
  trade_payoff: 0,
};

const baseVehicle = {
  id: "veh-1",
  stock_number: "118412R1",
  vin: "VIN123",
  year: 2011,
  make: "BUICK",
  model: "REGAL",
  odometer: 159000,
  status: "available",
  asking_price: 9997,
  date_in_stock: "2026-04-01",
  jd_power_retail_book: 6800,
  vehicle_category: "car" as const,
};

const baseUnderwriting = {
  apr: 28.99,
  max_amount_financed: 18000,
  max_ltv: 1.3,
  max_pti: null,
  max_term_months: 36,
  max_vehicle_price: 18000,
  min_cash_down: 1000,
  min_down_pct: 0,
  tier: "C",
};

const baseUwInputs = {
  gap_price: 599,
  gross_monthly_income: 3000,
  interest_rate_apr: 28.99,
  max_payment_pct: 0.168,
  term_months: 30,
  vsc_price: 1799,
};

test("deal structure input fingerprint changes when a structure input changes", () => {
  const a = buildDealStructureInputFingerprint(makeInputs());
  const b = buildDealStructureInputFingerprint(makeInputs({ sale_price: 10100 }));
  const c = buildDealStructureInputFingerprint(makeInputs({ doc_fee: 750 }));

  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("computeDealStructureState reflects edited structure inputs", () => {
  const computed = computeDealStructureState({
    dealId: "deal-1",
    deal: baseDeal,
    inputs: makeInputs({
      cash_down: 2500,
      doc_fee: 500,
      sale_price: 9000,
      term_months: 24,
      title_license: 150,
    }),
    underwriting: baseUnderwriting,
    underwritingInputs: baseUwInputs,
    vehicle: baseVehicle,
    vehicleTermPolicies: [
      {
        id: "p-1",
        sort_order: 1,
        min_mileage: 0,
        max_mileage: 200000,
        min_vehicle_age: 0,
        max_vehicle_age: 20,
        max_term_months: 36,
        active: true,
        notes: null,
      },
    ],
  });

  assert.equal(computed.structure.sale_price, 9000);
  assert.equal(computed.structure.cash_down_input, 2500);
  assert.equal(computed.structure.doc_fee, 500);
  assert.equal(computed.structure.title_license, 150);
  assert.equal(computed.structure.term_months, 24);
  assert.ok(computed.structure.amount_financed > 0);
  assert.ok(computed.structure.monthly_payment > 0);
});

test("computeDealStructureState rejects unsupported term values", () => {
  assert.throws(() =>
    computeDealStructureState({
      dealId: "deal-1",
      deal: baseDeal,
      inputs: makeInputs({ term_months: 60 }),
      underwriting: baseUnderwriting,
      underwritingInputs: baseUwInputs,
      vehicle: baseVehicle,
      vehicleTermPolicies: [
        {
          id: "p-1",
          sort_order: 1,
          min_mileage: 0,
          max_mileage: 200000,
          min_vehicle_age: 0,
          max_vehicle_age: 20,
          max_term_months: 36,
          active: true,
          notes: null,
        },
      ],
    })
  );
});
