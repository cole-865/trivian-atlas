import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { canAccessStep } from "@/lib/deals/canAccessStep";
import {
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import {
  scopeDealChildQueryToOrganization,
  scopeDealStageQueryToOrganization,
} from "@/lib/deals/underwritingOrganizationScope";
import {
  loadActiveVehicleTermPolicies,
  loadInventoryForOrganization,
  loadLatestTrivianConfig,
} from "@/lib/los/organizationScope";

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
  const payment = (P * (r * pow)) / (pow - 1);
  return round2(payment);
}

function principalFromPayment(payment: number, apr: number, termMonths: number): number {
  const PMT = Number(payment);
  const n = Number(termMonths);

  if (!PMT || PMT <= 0) return 0;
  if (!n || n <= 0) return 0;

  const aprNormalized = Number(apr) > 1 ? Number(apr) : Number(apr) * 100;
  const r = aprNormalized / 100 / 12;

  if (r === 0) return round2(PMT * n);

  const P = (PMT * (1 - Math.pow(1 + r, -n))) / r;
  return round2(P);
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

type PayOption = {
  label: "NONE" | "VSC" | "GAP" | "VSC+GAP";
  include_vsc: boolean;
  include_gap: boolean;
  product_total: number;
  tax_est: number;
  fees_est: number;
  amount_financed_est: number;
  monthly_payment: number;
  term_months: number;
  fits_cap: boolean;
  additional_down_needed: number;
  ltv_est: number;
  checks: {
    vehicle_price_ok: boolean;
    amount_financed_ok: boolean;
    ltv_ok: boolean;
    payment_ok: boolean;
  };
  fail_reasons: string[];
  additional_down_breakdown: {
    min_down: number;
    amount_financed: number;
    ltv: number;
    pti: number;
  };
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

function getVehicleAgeYears(year: number | null | undefined) {
  if (!year || !Number.isFinite(year)) return null;
  const currentYear = new Date().getFullYear();
  return Math.max(0, currentYear - year);
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
      .find((p) => {
        if (!p.active) return false;
        if (mileage == null || !Number.isFinite(mileage)) return false;
        if (ageYears == null || !Number.isFinite(ageYears)) return false;

        const mileageOk =
          (p.min_mileage == null || mileage >= p.min_mileage) &&
          (p.max_mileage == null || mileage <= p.max_mileage);

        const ageOk =
          (p.min_vehicle_age == null || ageYears >= p.min_vehicle_age) &&
          (p.max_vehicle_age == null || ageYears <= p.max_vehicle_age);

        return mileageOk && ageOk;
      }) ?? null;

  return {
    vehicle_age_years: ageYears,
    vehicle_policy_max_term_months: match?.max_term_months ?? null,
    vehicle_term_policy_note: match?.notes ?? null,
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  const cashDownOverride = url.searchParams.get("cashDown");

  const { data: deal, error: dealErr, organizationId } =
    await getDealForCurrentOrganization<{
      id: string;
      cash_down: number | null;
      trade_value: number | null;
      trade_payoff: number | null;
      has_trade: boolean | null;
      household_income: boolean | null;
    }>(
      supabase,
      dealId,
      "id, cash_down, trade_value, trade_payoff, has_trade, household_income"
    );

  if (!organizationId) {
    return NextResponse.json(
      { error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

  const { data: vehicleTermPolicies, error: vehicleTermPolicyError } =
    await loadActiveVehicleTermPolicies<VehicleTermPolicy>(supabase, organizationId);

  if (vehicleTermPolicyError) {
    return NextResponse.json(
      { error: "Failed to load vehicle term policy", details: vehicleTermPolicyError.message },
      { status: 500 }
    );
  }

  if (dealErr) {
    return NextResponse.json(
      { error: "Failed to load deal", details: dealErr.message },
      { status: 500 }
    );
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
    return NextResponse.json(
      { error: "Failed to load underwriting results", details: uwErr.message },
      { status: 500 }
    );
  }

  const access = await canAccessStep({
    supabase,
    step: "vehicle",
    deal: {
      household_income: deal?.household_income ?? null,
    },
    underwriting: {
      decision: uwResult?.decision ?? null,
    },
  });

  if (!access.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "STEP_BLOCKED",
        redirectTo: access.redirectTo ?? "income",
        reason: access.reason,
      },
      { status: 403 }
    );
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
    return NextResponse.json(
      { error: "Failed to load underwriting inputs", details: uwInputsErr.message },
      { status: 500 }
    );
  }

  const { data: cfg, error: cfgErr } = await loadLatestTrivianConfig<TrivianConfigSnapshot>(
    supabase,
    organizationId,
    "apr, payment_cap_pct, tax_rate_main, tax_add_base, tax_add_rate, doc_fee, title_license, vsc_price, gap_price"
  );

  if (cfgErr) {
    return NextResponse.json(
      { error: "Failed to load trivian config", details: cfgErr.message },
      { status: 500 }
    );
  }

  const { data: vehicles, error: invErr } = await loadInventoryForOrganization<InventoryVehicle>(
    supabase,
    organizationId,
    "id, stock_number, vin, year, make, model, odometer, status, asking_price, date_in_stock, jd_power_retail_book, vehicle_category",
    {
      offset,
      limit,
    }
  );

  if (invErr) {
    return NextResponse.json(
      { error: "Failed to load inventory", details: invErr.message },
      { status: 500 }
    );
  }

  const apr = Number(uwResult?.apr ?? 28.99);
  const underwritingMaxTermMonths = Number(
    uwResult?.max_term_months ?? uwInputs?.term_months ?? 48
  );

  const maxAmountFinanced = Number(uwResult?.max_amount_financed ?? 0);
  const maxVehiclePrice = Number(uwResult?.max_vehicle_price ?? 0);
  const maxLtv = Number(uwResult?.max_ltv ?? 0);

  const maxPayment = resolveMaxPayment({
    grossMonthlyIncome: Number(uwInputs?.gross_monthly_income ?? 0),
    maxPaymentPct: Number(uwInputs?.max_payment_pct ?? cfg?.payment_cap_pct ?? 0.22),
    maxPti: uwResult?.max_pti != null ? Number(uwResult.max_pti) : null,
  });

  const cashDown =
    cashDownOverride != null ? Number(cashDownOverride) : Number(deal?.cash_down ?? 0);

  const tradeValue = Number(deal?.trade_value ?? 0);
  const tradePayoff = Number(deal?.trade_payoff ?? 0);

  const tradeEquity = deal?.has_trade ? round2(tradeValue - tradePayoff) : 0;
  const positiveTradeEquity = round2(Math.max(0, tradeEquity));
  const negativeTradeEquity = round2(Math.max(0, -tradeEquity));

  const taxRateMain = Number(cfg?.tax_rate_main ?? 0.07);
  const taxAddBase = Number(cfg?.tax_add_base ?? 320);
  const taxAddRate = Number(cfg?.tax_add_rate ?? 0.07);

  const docFee = Number(cfg?.doc_fee ?? 895.5);
  const titleLicense = Number(cfg?.title_license ?? 0);

  const vscPrice = Number(uwInputs?.vsc_price ?? cfg?.vsc_price ?? 1799);
  const gapPrice = Number(uwInputs?.gap_price ?? cfg?.gap_price ?? 599);

  const optionsTemplate: Array<{
    label: PayOption["label"];
    vsc: boolean;
    gap: boolean;
    productTotal: number;
  }> = [
      { label: "VSC+GAP", vsc: true, gap: true, productTotal: round2(vscPrice + gapPrice) },
      { label: "VSC", vsc: true, gap: false, productTotal: round2(vscPrice) },
      { label: "GAP", vsc: false, gap: true, productTotal: round2(gapPrice) },
      { label: "NONE", vsc: false, gap: false, productTotal: 0 },
    ];

  const rows = ((vehicles ?? []) as InventoryVehicle[]).map((v) => {
    const price = Number(v.asking_price ?? 0);
    const retailBook = Number(v.jd_power_retail_book ?? 0);

    const {
      vehicle_age_years,
      vehicle_policy_max_term_months,
      vehicle_term_policy_note,
    } = resolveVehicleTermPolicy(v, (vehicleTermPolicies ?? []) as VehicleTermPolicy[]);

    const vehicleMaxTermMonths = Math.min(
      underwritingMaxTermMonths,
      vehicle_policy_max_term_months ?? underwritingMaxTermMonths
    );

    const vehicleBaseTermMonths = Math.max(1, vehicleMaxTermMonths - 6);

    const pctDown = round2(price * Number(uwResult?.min_down_pct ?? 0));
    const requiredDown = Math.max(Number(uwResult?.min_cash_down ?? 0), pctDown);

    const effectiveCashDown = round2(Math.max(cashDown, requiredDown));
    const effectiveDown = round2(effectiveCashDown + positiveTradeEquity);

    const minimumDownShortfall = round2(Math.max(0, requiredDown - cashDown));

    const vehiclePriceOk = maxVehiclePrice > 0 ? price <= maxVehiclePrice : true;

    const paymentOptions: PayOption[] = optionsTemplate.map((ot) => {
      const optionTermMonths = ot.vsc && ot.gap ? vehicleMaxTermMonths : vehicleBaseTermMonths;

      const taxableAmount = price + (ot.vsc ? vscPrice : 0);
      const tax = estimateTax(taxableAmount, taxRateMain, taxAddBase, taxAddRate);
      const baseFees = round2(docFee + titleLicense + tax);

      const amountFinanced = round2(
        price + baseFees + ot.productTotal + negativeTradeEquity - effectiveDown
      );

      const fitsAmountFinanced =
        maxAmountFinanced > 0 ? amountFinanced <= maxAmountFinanced : true;

      const ltv = retailBook > 0 ? round2(amountFinanced / retailBook) : 0;
      const fitsLtv = retailBook > 0 && maxLtv > 0 ? ltv <= maxLtv : true;

      const payment = monthlyPayment(amountFinanced, apr, optionTermMonths);
      const fitsPayment = maxPayment > 0 ? payment <= maxPayment : true;

      const fits = vehiclePriceOk && fitsAmountFinanced && fitsLtv && fitsPayment;

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
      if (maxPayment > 0 && !fitsPayment) {
        const principalAllowed = principalFromPayment(maxPayment, apr, optionTermMonths);
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
      if (!fitsAmountFinanced) failReasons.push("AMOUNT_FINANCED");
      if (!fitsLtv) failReasons.push("LTV");
      if (!fitsPayment) failReasons.push("PTI");

      return {
        label: ot.label,
        include_vsc: ot.vsc,
        include_gap: ot.gap,
        product_total: ot.productTotal,
        tax_est: tax,
        fees_est: baseFees,
        amount_financed_est: amountFinanced,
        monthly_payment: payment,
        term_months: optionTermMonths,
        fits_cap: fits,
        additional_down_needed: additionalDownNeeded,
        ltv_est: ltv,
        checks: {
          vehicle_price_ok: vehiclePriceOk,
          amount_financed_ok: fitsAmountFinanced,
          ltv_ok: fitsLtv,
          payment_ok: fitsPayment,
        },
        fail_reasons: failReasons,
        additional_down_breakdown: {
          min_down: minimumDownShortfall,
          amount_financed: downNeededForAmountFinanced,
          ltv: downNeededForLtv,
          pti: downNeededForPayment,
        },
      };
    });

    return {
      vehicle: {
        id: v.id,
        stock_number: v.stock_number,
        vin: v.vin,
        year: v.year,
        make: v.make,
        model: v.model,
        odometer: v.odometer,
        status: v.status,
        asking_price: price,
        date_in_stock: v.date_in_stock,
        jd_power_retail_book: retailBook,
        vehicle_category: v.vehicle_category,
        additional_down_required: minimumDownShortfall,
        vehicle_age_years,
        vehicle_policy_max_term_months,
        vehicle_term_policy_note,
      },
      assumptions: {
        apr,
        term_months: vehicleMaxTermMonths,
        base_term_months: vehicleBaseTermMonths,
        cash_down_used: effectiveDown,
        trade_value: tradeValue,
        trade_payoff: tradePayoff,
        trade_equity: tradeEquity,
        doc_fee: docFee,
        title_license: titleLicense,
        vsc_price: vscPrice,
        gap_price: gapPrice,
        max_payment_cap: maxPayment,
        max_amount_financed: maxAmountFinanced,
        max_vehicle_price: maxVehiclePrice,
        max_ltv: maxLtv,
        tier: uwResult?.tier ?? null,
      },
      payment_options: paymentOptions,
    };
  });

  return NextResponse.json({
    ok: true,
    deal_id: dealId,
    count: rows.length,
    offset,
    limit,
    rows,
  });
}
