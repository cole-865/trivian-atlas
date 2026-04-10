import { createHash } from "node:crypto";

export type DealStructureInputsRecord = {
  organization_id: string;
  deal_id: string;
  vehicle_id: string;
  option_label: "NONE" | "VSC" | "GAP" | "VSC+GAP";
  include_vsc: boolean;
  include_gap: boolean;
  term_months: number;
  cash_down: number | null;
  sale_price: number;
  tax_rate_main: number;
  tax_add_base: number;
  tax_add_rate: number;
  doc_fee: number;
  title_license: number;
  vsc_price: number;
  gap_price: number;
};

type VehicleTermPolicy = {
  id: string;
  sort_order: number;
  min_mileage: number | null;
  max_mileage: number | null;
  min_vehicle_age: number | null;
  max_vehicle_age: number | null;
  max_term_months: number;
  active: boolean;
  notes: string | null;
};

type InventoryVehicle = {
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

type UnderwritingResult = {
  apr: number | null;
  max_amount_financed: number | null;
  max_ltv: number | null;
  max_pti: number | null;
  max_term_months: number | null;
  max_vehicle_price: number | null;
  min_cash_down: number | null;
  min_down_pct: number | null;
  tier: string | null;
};

type UnderwritingInputs = {
  gap_price: number | null;
  gross_monthly_income: number | null;
  interest_rate_apr: number | null;
  max_payment_pct: number | null;
  term_months: number | null;
  vsc_price: number | null;
};

type DealRow = {
  cash_down: number | null;
  customer_name: string | null;
  has_trade: boolean | null;
  id: string;
  trade_payoff: number | null;
};

export type DealStructureComputedState = {
  assumptions: {
    tier: string | null;
    max_payment_cap: number;
    max_amount_financed: number;
    max_vehicle_price: number;
    max_ltv: number;
    trade_payoff: number;
    underwriting_max_term_months: number;
    vehicle_max_term_months: number;
    vehicle_base_term_months: number;
  };
  structure: {
    sale_price: number;
    cash_down_input: number;
    cash_down_effective: number;
    required_down: number;
    additional_down_needed: number;
    taxable_amount: number;
    sales_tax: number;
    doc_fee: number;
    title_license: number;
    fees_total: number;
    product_total: number;
    vsc_price: number;
    gap_price: number;
    amount_financed: number;
    apr: number;
    term_months: number;
    monthly_payment: number;
    ltv: number;
    fits_program: boolean;
    fail_reasons: string[];
    checks: {
      vehicle_price_ok: boolean;
      amount_financed_ok: boolean;
      ltv_ok: boolean;
      payment_ok: boolean;
    };
    additional_down_breakdown: {
      min_down: number;
      amount_financed: number;
      ltv: number;
      pti: number;
    };
  };
  vehicle: {
    id: string;
    stock_number: string | null;
    vin: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
    odometer: number | null;
    status: string | null;
    date_in_stock: string | null;
    asking_price: number;
    jd_power_retail_book: number;
    vehicle_category: "car" | "suv" | "truck" | "van" | null;
    vehicle_age_years: number | null;
    vehicle_policy_max_term_months: number | null;
    vehicle_term_policy_note: string | null;
  };
  selection: {
    vehicle_id: string;
    option_label: "NONE" | "VSC" | "GAP" | "VSC+GAP";
    include_vsc: boolean;
    include_gap: boolean;
  };
};

function round2(n: number) {
  return Number((n || 0).toFixed(2));
}

function monthlyPayment(principal: number, apr: number, termMonths: number): number {
  const P = Number(principal);
  const n = Number(termMonths);
  if (!P || P <= 0 || !n || n <= 0) return 0;
  const aprNormalized = Number(apr) > 1 ? Number(apr) : Number(apr) * 100;
  const r = aprNormalized / 100 / 12;
  if (r === 0) return round2(P / n);
  const pow = Math.pow(1 + r, n);
  return round2((P * (r * pow)) / (pow - 1));
}

function estimateTax(
  taxableAmount: number,
  taxRateMain: number,
  taxAddBase: number,
  taxAddRate: number
) {
  const p = Number(taxableAmount) || 0;
  const main = p * (Number(taxRateMain) || 0);
  const add = Math.min(p, Number(taxAddBase) || 0) * (Number(taxAddRate) || 0);
  return round2(main + add);
}

function resolveMaxPayment(args: {
  grossMonthlyIncome: number;
  maxPaymentPct: number;
  maxPti: number | null;
}) {
  const grossMonthlyIncome = Number(args.grossMonthlyIncome ?? 0);
  const basePct = Number(args.maxPaymentPct ?? 0);
  const maxPti = args.maxPti != null ? Number(args.maxPti) : null;
  if (grossMonthlyIncome <= 0) return 0;
  if (maxPti != null && Number.isFinite(maxPti) && maxPti > 0) {
    return round2(grossMonthlyIncome * maxPti);
  }
  return round2(grossMonthlyIncome * (basePct > 0 ? basePct : 0.22));
}

function getVehicleAgeYears(year: number | null | undefined) {
  if (!year || !Number.isFinite(year)) return null;
  return Math.max(0, new Date().getFullYear() - year);
}

function resolveVehicleTermPolicy(
  vehicle: Pick<InventoryVehicle, "year" | "odometer">,
  policies: VehicleTermPolicy[]
) {
  const ageYears = getVehicleAgeYears(vehicle.year);
  const mileage = vehicle.odometer != null ? Number(vehicle.odometer) : null;
  const match =
    [...policies]
      .sort((a, b) => a.sort_order - b.sort_order)
      .find((policy) => {
        if (!policy.active || mileage == null || ageYears == null) return false;
        const mileageOk =
          (policy.min_mileage == null || mileage >= policy.min_mileage) &&
          (policy.max_mileage == null || mileage <= policy.max_mileage);
        const ageOk =
          (policy.min_vehicle_age == null || ageYears >= policy.min_vehicle_age) &&
          (policy.max_vehicle_age == null || ageYears <= policy.max_vehicle_age);
        return mileageOk && ageOk;
      }) ?? null;

  return {
    vehicle_age_years: ageYears,
    vehicle_policy_max_term_months: match?.max_term_months ?? null,
    vehicle_term_policy_note: match?.notes ?? null,
  };
}

function stableStringify(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = value[key];
        return acc;
      }, {})
  );
}

function moneyToCents(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(Number(value) * 100);
}

function ratioToFixed(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(Number(value) * 10000);
}

function inferOptionLabel(includeVsc: boolean, includeGap: boolean) {
  if (includeVsc && includeGap) return "VSC+GAP";
  if (includeVsc) return "VSC";
  if (includeGap) return "GAP";
  return "NONE";
}

export function buildDealStructureInputFingerprint(inputs: DealStructureInputsRecord) {
  const normalized = {
    cashDownCents: moneyToCents(inputs.cash_down),
    docFeeCents: moneyToCents(inputs.doc_fee),
    gapPriceCents: moneyToCents(inputs.gap_price),
    includeGap: !!inputs.include_gap,
    includeVsc: !!inputs.include_vsc,
    optionLabel: inputs.option_label,
    salePriceCents: moneyToCents(inputs.sale_price),
    taxAddBaseCents: moneyToCents(inputs.tax_add_base),
    taxAddRateFixed: ratioToFixed(inputs.tax_add_rate),
    taxRateMainFixed: ratioToFixed(inputs.tax_rate_main),
    termMonths: Number(inputs.term_months),
    titleLicenseCents: moneyToCents(inputs.title_license),
    vehicleId: inputs.vehicle_id,
    vscPriceCents: moneyToCents(inputs.vsc_price),
  };

  return createHash("sha256").update(stableStringify(normalized)).digest("hex");
}

export function computeDealStructureState(args: {
  dealId: string;
  deal: DealRow;
  inputs: DealStructureInputsRecord;
  underwriting: UnderwritingResult | null;
  underwritingInputs: UnderwritingInputs | null;
  vehicle: InventoryVehicle;
  vehicleTermPolicies: VehicleTermPolicy[];
}): DealStructureComputedState {
  const { inputs, underwriting, underwritingInputs, vehicle } = args;
  const apr = Number(underwriting?.apr ?? 28.99);
  const underwritingMaxTermMonths = Number(
    underwriting?.max_term_months ?? underwritingInputs?.term_months ?? 48
  );
  const maxAmountFinanced = Number(underwriting?.max_amount_financed ?? 0);
  const maxVehiclePrice = Number(underwriting?.max_vehicle_price ?? 0);
  const maxLtv = Number(underwriting?.max_ltv ?? 0);
  const maxPayment = resolveMaxPayment({
    grossMonthlyIncome: Number(underwritingInputs?.gross_monthly_income ?? 0),
    maxPaymentPct: Number(underwritingInputs?.max_payment_pct ?? 0.22),
    maxPti: underwriting?.max_pti != null ? Number(underwriting.max_pti) : null,
  });

  const {
    vehicle_age_years,
    vehicle_policy_max_term_months,
    vehicle_term_policy_note,
  } = resolveVehicleTermPolicy(vehicle, args.vehicleTermPolicies);

  const vehicleMaxTermMonths = Math.min(
    underwritingMaxTermMonths,
    vehicle_policy_max_term_months ?? underwritingMaxTermMonths
  );
  const vehicleBaseTermMonths = Math.max(1, vehicleMaxTermMonths - 6);
  const termMonths = Number(inputs.term_months ?? vehicleBaseTermMonths);

  if (!Number.isFinite(termMonths) || termMonths <= 0 || termMonths > vehicleMaxTermMonths) {
    throw new Error(`Term must be between 1 and ${vehicleMaxTermMonths} months for this structure.`);
  }

  const salePrice = Number(inputs.sale_price ?? vehicle.asking_price ?? 0);
  const cashDown = Number(inputs.cash_down ?? args.deal.cash_down ?? 0);
  const retailBook = Number(vehicle.jd_power_retail_book ?? 0);
  const pctDown = round2(salePrice * Number(underwriting?.min_down_pct ?? 0));
  const requiredDown = Math.max(Number(underwriting?.min_cash_down ?? 0), pctDown);
  const effectiveDown = round2(Math.max(cashDown, requiredDown));
  const minimumDownShortfall = round2(Math.max(0, requiredDown - cashDown));
  const vehiclePriceOk = maxVehiclePrice > 0 ? salePrice <= maxVehiclePrice : true;

  const vscPrice = inputs.include_vsc ? Number(inputs.vsc_price ?? 0) : 0;
  const gapPrice = inputs.include_gap ? Number(inputs.gap_price ?? 0) : 0;
  const optionProductTotal = round2(vscPrice + gapPrice);
  const taxableAmount = salePrice + vscPrice;
  const salesTax = estimateTax(
    taxableAmount,
    Number(inputs.tax_rate_main ?? 0),
    Number(inputs.tax_add_base ?? 0),
    Number(inputs.tax_add_rate ?? 0)
  );
  const feesTotal = round2(Number(inputs.doc_fee ?? 0) + Number(inputs.title_license ?? 0) + salesTax);
  const amountFinanced = round2(salePrice + feesTotal + optionProductTotal - effectiveDown);
  const amountFinancedOk = maxAmountFinanced > 0 ? amountFinanced <= maxAmountFinanced : true;

  const ltv = retailBook > 0 ? round2(amountFinanced / retailBook) : 0;
  const ltvOk = retailBook > 0 && maxLtv > 0 ? ltv <= maxLtv : true;
  const monthlyPmt = monthlyPayment(amountFinanced, apr, termMonths);
  const paymentOk = maxPayment > 0 ? monthlyPmt <= maxPayment : true;

  let downNeededForAmountFinanced = 0;
  if (maxAmountFinanced > 0 && amountFinanced > maxAmountFinanced) {
    downNeededForAmountFinanced = round2(amountFinanced - maxAmountFinanced);
  }

  let downNeededForLtv = 0;
  if (retailBook > 0 && maxLtv > 0) {
    const allowedFinancedByLtv = round2(retailBook * maxLtv);
    if (amountFinanced > allowedFinancedByLtv) {
      downNeededForLtv = round2(amountFinanced - allowedFinancedByLtv);
    }
  }

  let downNeededForPayment = 0;
  if (maxPayment > 0 && !paymentOk) {
    const aprNormalized = Number(apr) > 1 ? Number(apr) : Number(apr) * 100;
    const r = aprNormalized / 100 / 12;
    const principalAllowed =
      r === 0
        ? round2(maxPayment * termMonths)
        : round2((maxPayment * (1 - Math.pow(1 + r, -termMonths))) / r);
    downNeededForPayment = round2(Math.max(0, amountFinanced - principalAllowed));
  }

  const additionalDownNeeded = round2(
    Math.max(
      minimumDownShortfall,
      downNeededForAmountFinanced,
      downNeededForLtv,
      downNeededForPayment
    )
  );

  const failReasons: string[] = [];
  if (!vehiclePriceOk) failReasons.push("VEHICLE_PRICE");
  if (!amountFinancedOk) failReasons.push("AMOUNT_FINANCED");
  if (!ltvOk) failReasons.push("LTV");
  if (!paymentOk) failReasons.push("PTI");

  return {
    selection: {
      vehicle_id: inputs.vehicle_id,
      option_label: inferOptionLabel(inputs.include_vsc, inputs.include_gap),
      include_vsc: !!inputs.include_vsc,
      include_gap: !!inputs.include_gap,
    },
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
      jd_power_retail_book: retailBook,
      vehicle_category: vehicle.vehicle_category,
      vehicle_age_years,
      vehicle_policy_max_term_months,
      vehicle_term_policy_note,
    },
    structure: {
      sale_price: round2(salePrice),
      cash_down_input: round2(cashDown),
      cash_down_effective: effectiveDown,
      required_down: round2(requiredDown),
      additional_down_needed: additionalDownNeeded,
      taxable_amount: round2(taxableAmount),
      sales_tax: salesTax,
      doc_fee: round2(inputs.doc_fee),
      title_license: round2(inputs.title_license),
      fees_total: feesTotal,
      product_total: optionProductTotal,
      vsc_price: round2(vscPrice),
      gap_price: round2(gapPrice),
      amount_financed: amountFinanced,
      apr: round2(apr),
      term_months: termMonths,
      monthly_payment: monthlyPmt,
      ltv: retailBook > 0 ? ltv : 0,
      fits_program: vehiclePriceOk && amountFinancedOk && ltvOk && paymentOk,
      fail_reasons: failReasons,
      checks: {
        vehicle_price_ok: vehiclePriceOk,
        amount_financed_ok: amountFinancedOk,
        ltv_ok: ltvOk,
        payment_ok: paymentOk,
      },
      additional_down_breakdown: {
        min_down: minimumDownShortfall,
        amount_financed: downNeededForAmountFinanced,
        ltv: downNeededForLtv,
        pti: downNeededForPayment,
      },
    },
    assumptions: {
      tier: underwriting?.tier ?? null,
      max_payment_cap: maxPayment,
      max_amount_financed: maxAmountFinanced,
      max_vehicle_price: maxVehiclePrice,
      max_ltv: maxLtv,
      trade_payoff: Number(args.deal.trade_payoff ?? 0),
      underwriting_max_term_months: underwritingMaxTermMonths,
      vehicle_max_term_months: vehicleMaxTermMonths,
      vehicle_base_term_months: vehicleBaseTermMonths,
    },
  };
}
