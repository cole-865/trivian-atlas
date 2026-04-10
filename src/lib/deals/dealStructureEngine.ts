import { createHash } from "node:crypto";
import {
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { scopeDealChildQueryToOrganization, scopeDealStageQueryToOrganization } from "@/lib/deals/underwritingOrganizationScope";
import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";
import {
  loadActiveVehicleTermPolicies,
  loadInventoryVehicleForOrganization,
  loadLatestTrivianConfig,
} from "@/lib/los/organizationScope";

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
  created_at?: string;
  updated_at?: string;
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

type TrivianConfigSnapshot = {
  apr: number | null;
  payment_cap_pct: number | null;
  tax_rate_main: number | null;
  tax_add_base: number | null;
  tax_add_rate: number | null;
  doc_fee: number | null;
  title_license: number | null;
  vsc_price: number | null;
  gap_price: number | null;
};

type UnderwritingResult = {
  apr: number | null;
  decision?: string | null;
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

type SelectionRow = {
  cash_down: number | null;
  deal_id: string;
  include_gap: boolean;
  include_vsc: boolean;
  option_label: "NONE" | "VSC" | "GAP" | "VSC+GAP";
  term_months: number | null;
  vehicle_id: string;
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

export type DealStructureContext = {
  customerName: string | null;
  deal: DealRow;
  inputs: DealStructureInputsRecord;
  organizationId: string;
  selection: SelectionRow;
  underwriting: UnderwritingResult | null;
  underwritingInputs: UnderwritingInputs | null;
};

function round2(n: number) {
  return Number((n || 0).toFixed(2));
}

function monthlyPayment(principal: number, apr: number, termMonths: number): number {
  const P = Number(principal);
  const n = Number(termMonths);

  if (!P || P <= 0) return 0;
  if (!n || n <= 0) return 0;

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
        if (!policy.active || mileage == null || ageYears == null) {
          return false;
        }

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
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(Number(value) * 100);
}

function ratioToFixed(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(Number(value) * 10000);
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

  return createHash("sha256")
    .update(stableStringify(normalized))
    .digest("hex");
}

function inferOptionLabel(includeVsc: boolean, includeGap: boolean) {
  if (includeVsc && includeGap) return "VSC+GAP";
  if (includeVsc) return "VSC";
  if (includeGap) return "GAP";
  return "NONE";
}

export async function loadDealStructureContext(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").supabaseServer>>,
  dealId: string
) {
  const { data: deal, error: dealErr, organizationId } =
    await getDealForCurrentOrganization<DealRow>(
      supabase,
      dealId,
      "id, customer_name, cash_down, trade_payoff, has_trade"
    );

  if (!organizationId) {
    throw new Error(NO_CURRENT_ORGANIZATION_MESSAGE);
  }

  if (dealErr) {
    throw new Error(`Failed to load deal: ${dealErr.message}`);
  }

  if (!deal) {
    throw new Error("Deal not found");
  }

  const { data: selection, error: selectionErr } = await scopeQueryToOrganization(
    supabase
      .from("deal_vehicle_selection")
      .select("deal_id, vehicle_id, option_label, include_vsc, include_gap, cash_down, term_months"),
    organizationId
  )
    .eq("deal_id", dealId)
    .maybeSingle();

  if (selectionErr) {
    throw new Error(`Failed to load saved vehicle selection: ${selectionErr.message}`);
  }

  if (!selection) {
    throw new Error("No vehicle selection found for this deal");
  }

  const { data: uwResult, error: uwErr } =
    await scopeDealStageQueryToOrganization(
      supabase
        .from("underwriting_results")
        .select(
          "decision, tier, max_pti, max_term_months, min_cash_down, min_down_pct, max_amount_financed, max_vehicle_price, max_ltv, apr"
        ),
      organizationId,
      dealId,
      "bureau_precheck"
    ).maybeSingle();

  if (uwErr) {
    throw new Error(`Failed to load underwriting results: ${uwErr.message}`);
  }

  const { data: uwInputs, error: uwInputsErr } =
    await scopeDealChildQueryToOrganization(
      supabase
        .from("underwriting_inputs")
        .select(
          "gross_monthly_income, interest_rate_apr, term_months, max_payment_pct, vsc_price, gap_price"
        ),
      organizationId,
      dealId
    ).maybeSingle();

  if (uwInputsErr) {
    throw new Error(`Failed to load underwriting inputs: ${uwInputsErr.message}`);
  }

  const { data: cfg, error: cfgErr } = await loadLatestTrivianConfig<TrivianConfigSnapshot>(
    supabase,
    organizationId,
    "apr, payment_cap_pct, tax_rate_main, tax_add_base, tax_add_rate, doc_fee, title_license, vsc_price, gap_price"
  );

  if (cfgErr) {
    throw new Error(`Failed to load trivian config: ${cfgErr.message}`);
  }

  const { data: vehicle, error: vehicleErr } =
    await loadInventoryVehicleForOrganization<InventoryVehicle>(
      supabase,
      organizationId,
      selection.vehicle_id,
      "id, stock_number, vin, year, make, model, odometer, status, asking_price, date_in_stock, jd_power_retail_book, vehicle_category"
    );

  if (vehicleErr) {
    throw new Error(`Failed to load selected vehicle: ${vehicleErr.message}`);
  }

  if (!vehicle) {
    throw new Error("Selected vehicle was not found in inventory");
  }

  const { data: vehicleTermPolicies, error: vehicleTermPolicyError } =
    await loadActiveVehicleTermPolicies<VehicleTermPolicy>(supabase, organizationId);

  if (vehicleTermPolicyError) {
    throw new Error(`Failed to load vehicle term policy: ${vehicleTermPolicyError.message}`);
  }

  const defaultInputs: DealStructureInputsRecord = {
    organization_id: organizationId,
    deal_id: dealId,
    vehicle_id: selection.vehicle_id,
    option_label: selection.option_label,
    include_vsc: !!selection.include_vsc,
    include_gap: !!selection.include_gap,
    term_months: Number(selection.term_months ?? uwInputs?.term_months ?? 48),
    cash_down: selection.cash_down ?? deal.cash_down ?? 0,
    sale_price: Number(vehicle.asking_price ?? 0),
    tax_rate_main: Number(cfg?.tax_rate_main ?? 0.07),
    tax_add_base: Number(cfg?.tax_add_base ?? 320),
    tax_add_rate: Number(cfg?.tax_add_rate ?? 0.07),
    doc_fee: Number(cfg?.doc_fee ?? 895.5),
    title_license: Number(cfg?.title_license ?? 0),
    vsc_price: Number(uwInputs?.vsc_price ?? cfg?.vsc_price ?? 1799),
    gap_price: Number(uwInputs?.gap_price ?? cfg?.gap_price ?? 599),
  };

  const { data: existingInputs, error: existingInputsErr } = await scopeQueryToOrganization(
    supabase.from("deal_structure_inputs").select("*"),
    organizationId
  )
    .eq("deal_id", dealId)
    .maybeSingle();

  if (existingInputsErr) {
    throw new Error(`Failed to load deal structure inputs: ${existingInputsErr.message}`);
  }

  const shouldReseedInputs =
    !existingInputs ||
    existingInputs.vehicle_id !== selection.vehicle_id;

  const inputs = {
    ...defaultInputs,
    ...(shouldReseedInputs ? {} : existingInputs),
    organization_id: organizationId,
    deal_id: dealId,
    vehicle_id: selection.vehicle_id,
    option_label:
      (existingInputs?.option_label as DealStructureInputsRecord["option_label"] | undefined) ??
      selection.option_label,
    include_vsc:
      typeof existingInputs?.include_vsc === "boolean"
        ? !!existingInputs.include_vsc
        : !!selection.include_vsc,
    include_gap:
      typeof existingInputs?.include_gap === "boolean"
        ? !!existingInputs.include_gap
        : !!selection.include_gap,
  } satisfies DealStructureInputsRecord;

  return {
    customerName: deal.customer_name,
    deal,
    defaultInputs,
    inputs,
    organizationId,
    selection: selection as SelectionRow,
    underwriting: (uwResult as UnderwritingResult | null) ?? null,
    underwritingInputs: (uwInputs as UnderwritingInputs | null) ?? null,
    vehicle,
    vehicleTermPolicies: (vehicleTermPolicies ?? []) as VehicleTermPolicy[],
    config: cfg ?? null,
  };
}

export function computeDealStructureState(args: {
  dealId: string;
  deal: DealRow;
  inputs: DealStructureInputsRecord;
  underwriting: UnderwritingResult | null;
  underwritingInputs: UnderwritingInputs | null;
  vehicle: InventoryVehicle;
  vehicleTermPolicies: VehicleTermPolicy[];
}) {
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

  const assumptions = {
    tier: underwriting?.tier ?? null,
    max_payment_cap: maxPayment,
    max_amount_financed: maxAmountFinanced,
    max_vehicle_price: maxVehiclePrice,
    max_ltv: maxLtv,
    trade_payoff: Number(args.deal.trade_payoff ?? 0),
    underwriting_max_term_months: underwritingMaxTermMonths,
    vehicle_max_term_months: vehicleMaxTermMonths,
    vehicle_base_term_months: vehicleBaseTermMonths,
  };

  const state: DealStructureComputedState = {
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
    assumptions,
  };

  return state;
}

export async function persistDealStructureState(args: {
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").supabaseServer>>;
  organizationId: string;
  dealId: string;
  inputs: DealStructureInputsRecord;
  computed: DealStructureComputedState;
}) {
  const now = new Date().toISOString();
  const normalizedInputs = {
    ...args.inputs,
    option_label: inferOptionLabel(args.inputs.include_vsc, args.inputs.include_gap),
    updated_at: now,
  };

  const { error: inputErr } = await args.supabase
    .from("deal_structure_inputs")
    .upsert(
      {
        ...normalizedInputs,
        created_at: now,
      },
      { onConflict: "deal_id" }
    );

  if (inputErr) {
    throw new Error(`Failed to save deal structure inputs: ${inputErr.message}`);
  }

  const snapshot = {
    deal_id: args.dealId,
    selection: args.computed.selection,
    vehicle: args.computed.vehicle,
    structure: args.computed.structure,
    assumptions: args.computed.assumptions,
  };

  const { error: upsertErr } = await args.supabase.from("deal_structure").upsert(
    {
      organization_id: args.organizationId,
      deal_id: args.dealId,
      vehicle_id: args.inputs.vehicle_id,
      option_label: args.computed.selection.option_label,
      include_vsc: args.inputs.include_vsc,
      include_gap: args.inputs.include_gap,
      sale_price: args.computed.structure.sale_price,
      cash_down: args.computed.structure.cash_down_effective,
      trade_payoff: args.computed.assumptions.trade_payoff,
      jd_power_retail_book: args.computed.vehicle.jd_power_retail_book,
      taxable_amount: args.computed.structure.taxable_amount,
      sales_tax: args.computed.structure.sales_tax,
      doc_fee: args.computed.structure.doc_fee,
      title_license: args.computed.structure.title_license,
      fees_total: args.computed.structure.fees_total,
      product_total: args.computed.structure.product_total,
      vsc_price: args.computed.structure.vsc_price,
      gap_price: args.computed.structure.gap_price,
      amount_financed: args.computed.structure.amount_financed,
      apr: args.computed.structure.apr,
      term_months: args.computed.structure.term_months,
      monthly_payment: args.computed.structure.monthly_payment,
      ltv: args.computed.vehicle.jd_power_retail_book > 0 ? args.computed.structure.ltv : null,
      fits_program: args.computed.structure.fits_program,
      fail_reasons: args.computed.structure.fail_reasons,
      snapshot_json: snapshot,
      updated_at: now,
    },
    { onConflict: "deal_id" }
  );

  if (upsertErr) {
    throw new Error(`Failed to save deal structure: ${upsertErr.message}`);
  }

  const { error: selectionErr } = await args.supabase
    .from("deal_vehicle_selection")
    .upsert(
      {
        organization_id: args.organizationId,
        deal_id: args.dealId,
        vehicle_id: args.inputs.vehicle_id,
        option_label: args.computed.selection.option_label,
        include_vsc: args.inputs.include_vsc,
        include_gap: args.inputs.include_gap,
        term_months: args.computed.structure.term_months,
        monthly_payment: args.computed.structure.monthly_payment,
        cash_down: args.inputs.cash_down,
        updated_at: now,
      },
      { onConflict: "deal_id" }
    );

  if (selectionErr) {
    throw new Error(`Failed to sync deal vehicle selection: ${selectionErr.message}`);
  }
}
