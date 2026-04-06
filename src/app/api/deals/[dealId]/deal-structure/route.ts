import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

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

type SelectedOption = "NONE" | "VSC" | "GAP" | "VSC+GAP";

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

function normalizeSelectedOption(value: string | null | undefined): SelectedOption | null {
    if (value === "NONE" || value === "VSC" || value === "GAP" || value === "VSC+GAP") {
        return value;
    }
    return null;
}

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ dealId: string }> }
) {
    const { dealId } = await params;
    const supabase = await supabaseServer();

    const { data: selection, error: selectionErr } = await supabase
        .from("deal_vehicle_selection")
        .select(
            "deal_id, vehicle_id, option_label, include_vsc, include_gap, monthly_payment, term_months, cash_down"
        )
        .eq("deal_id", dealId)
        .maybeSingle();

    if (selectionErr) {
        return NextResponse.json(
            { error: "Failed to load saved vehicle selection", details: selectionErr.message },
            { status: 500 }
        );
    }

    if (!selection) {
        return NextResponse.json(
            { error: "No vehicle selection found for this deal" },
            { status: 404 }
        );
    }

    const selectedOption = normalizeSelectedOption(selection.option_label);
    if (!selectedOption) {
        return NextResponse.json(
            { error: "Saved vehicle option is invalid" },
            { status: 400 }
        );
    }

    const { data: vehicleTermPolicies, error: vehicleTermPolicyError } = await supabase
        .from("vehicle_term_policy")
        .select(
            "id, sort_order, min_mileage, max_mileage, min_vehicle_age, max_vehicle_age, max_term_months, active, notes"
        )
        .eq("active", true)
        .order("sort_order", { ascending: true });

    if (vehicleTermPolicyError) {
        return NextResponse.json(
            { error: "Failed to load vehicle term policy", details: vehicleTermPolicyError.message },
            { status: 500 }
        );
    }

    const { data: deal, error: dealErr } = await supabase
        .from("deals")
        .select("id, cash_down, trade_payoff, has_trade")
        .eq("id", dealId)
        .single();

    if (dealErr) {
        return NextResponse.json(
            { error: "Failed to load deal", details: dealErr.message },
            { status: 500 }
        );
    }

    const { data: uwResult, error: uwErr } = await supabase
        .from("underwriting_results")
        .select(
            "tier, max_pti, max_term_months, min_cash_down, min_down_pct, max_amount_financed, max_vehicle_price, max_ltv, apr"
        )
        .eq("deal_id", dealId)
        .eq("stage", "bureau_precheck")
        .maybeSingle();

    if (uwErr) {
        return NextResponse.json(
            { error: "Failed to load underwriting results", details: uwErr.message },
            { status: 500 }
        );
    }

    const { data: uwInputs, error: uwInputsErr } = await supabase
        .from("underwriting_inputs")
        .select("gross_monthly_income, interest_rate_apr, term_months, max_payment_pct, vsc_price, gap_price")
        .eq("deal_id", dealId)
        .maybeSingle();

    if (uwInputsErr) {
        return NextResponse.json(
            { error: "Failed to load underwriting inputs", details: uwInputsErr.message },
            { status: 500 }
        );
    }

    const { data: cfg, error: cfgErr } = await supabase
        .from("trivian_config")
        .select(
            "apr, payment_cap_pct, tax_rate_main, tax_add_base, tax_add_rate, doc_fee, title_license, vsc_price, gap_price"
        )
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (cfgErr) {
        return NextResponse.json(
            { error: "Failed to load trivian config", details: cfgErr.message },
            { status: 500 }
        );
    }

    const { data: vehicle, error: vehicleErr } = await supabase
        .from("trivian_inventory")
        .select(
            "id, stock_number, vin, year, make, model, odometer, status, asking_price, date_in_stock, jd_power_retail_book, vehicle_category"
        )
        .eq("id", selection.vehicle_id)
        .maybeSingle();

    if (vehicleErr) {
        return NextResponse.json(
            { error: "Failed to load selected vehicle", details: vehicleErr.message },
            { status: 500 }
        );
    }

    if (!vehicle) {
        return NextResponse.json(
            { error: "Selected vehicle was not found in inventory" },
            { status: 404 }
        );
    }

    const v = vehicle as InventoryVehicle;

    const apr = Number(uwResult?.apr ?? cfg?.apr ?? 28.99);
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

    const cashDown = Number(selection.cash_down ?? deal?.cash_down ?? 0);
    const tradePayoff = Number(deal?.trade_payoff ?? 0);

    const taxRateMain = Number(cfg?.tax_rate_main ?? 0.07);
    const taxAddBase = Number(cfg?.tax_add_base ?? 320);
    const taxAddRate = Number(cfg?.tax_add_rate ?? 0.07);

    const docFee = Number(cfg?.doc_fee ?? 895.5);
    const titleLicense = Number(cfg?.title_license ?? 0);

    const vscPrice = Number(uwInputs?.vsc_price ?? cfg?.vsc_price ?? 1799);
    const gapPrice = Number(uwInputs?.gap_price ?? cfg?.gap_price ?? 599);

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

    const includeVsc = Boolean(selection.include_vsc);
    const includeGap = Boolean(selection.include_gap);

    const optionTermMonths =
        includeVsc && includeGap ? vehicleMaxTermMonths : vehicleBaseTermMonths;

    const optionProductTotal = round2((includeVsc ? vscPrice : 0) + (includeGap ? gapPrice : 0));

    const price = Number(v.asking_price ?? 0);
    const retailBook = Number(v.jd_power_retail_book ?? 0);

    const pctDown = round2(price * Number(uwResult?.min_down_pct ?? 0));
    const requiredDown = Math.max(Number(uwResult?.min_cash_down ?? 0), pctDown);
    const effectiveDown = round2(Math.max(cashDown, requiredDown));
    const minimumDownShortfall = round2(Math.max(0, requiredDown - cashDown));

    const vehiclePriceOk = maxVehiclePrice > 0 ? price <= maxVehiclePrice : true;

    const taxableAmount = price + (includeVsc ? vscPrice : 0);
    const salesTax = estimateTax(taxableAmount, taxRateMain, taxAddBase, taxAddRate);
    const feesTotal = round2(docFee + titleLicense + salesTax);
    const amountFinanced = round2(price + feesTotal + optionProductTotal - effectiveDown);

    const amountFinancedOk =
        maxAmountFinanced > 0 ? amountFinanced <= maxAmountFinanced : true;

    const ltv = retailBook > 0 ? round2(amountFinanced / retailBook) : 0;
    const ltvOk = retailBook > 0 && maxLtv > 0 ? ltv <= maxLtv : true;

    const monthlyPmt = monthlyPayment(amountFinanced, apr, optionTermMonths);
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
        const n = Number(optionTermMonths);
        const principalAllowed =
            r === 0
                ? round2(maxPayment * n)
                : round2((maxPayment * (1 - Math.pow(1 + r, -n))) / r);

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

    const fitsProgram = vehiclePriceOk && amountFinancedOk && ltvOk && paymentOk;

    const snapshot = {
        deal_id: dealId,
        selection: {
            vehicle_id: selection.vehicle_id,
            option_label: selectedOption,
            include_vsc: includeVsc,
            include_gap: includeGap,
        },
        vehicle: {
            id: v.id,
            stock_number: v.stock_number,
            vin: v.vin,
            year: v.year,
            make: v.make,
            model: v.model,
            odometer: v.odometer,
            status: v.status,
            date_in_stock: v.date_in_stock,
            asking_price: price,
            jd_power_retail_book: retailBook,
            vehicle_category: v.vehicle_category,
            vehicle_age_years,
            vehicle_policy_max_term_months,
            vehicle_term_policy_note,
        },
        structure: {
            sale_price: price,
            cash_down_input: cashDown,
            cash_down_effective: effectiveDown,
            required_down: requiredDown,
            additional_down_needed: additionalDownNeeded,
            taxable_amount: round2(taxableAmount),
            sales_tax: salesTax,
            doc_fee: docFee,
            title_license: titleLicense,
            fees_total: feesTotal,
            product_total: optionProductTotal,
            vsc_price: includeVsc ? vscPrice : 0,
            gap_price: includeGap ? gapPrice : 0,
            amount_financed: amountFinanced,
            apr,
            term_months: optionTermMonths,
            monthly_payment: monthlyPmt,
            ltv,
            fits_program: fitsProgram,
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
            tier: uwResult?.tier ?? null,
            max_payment_cap: maxPayment,
            max_amount_financed: maxAmountFinanced,
            max_vehicle_price: maxVehiclePrice,
            max_ltv: maxLtv,
            trade_payoff: tradePayoff,
            underwriting_max_term_months: underwritingMaxTermMonths,
            vehicle_max_term_months: vehicleMaxTermMonths,
            vehicle_base_term_months: vehicleBaseTermMonths,
        },
    };

    const { error: upsertErr } = await supabase.from("deal_structure").upsert(
        {
            deal_id: dealId,
            vehicle_id: v.id,
            option_label: selectedOption,
            include_vsc: includeVsc,
            include_gap: includeGap,
            sale_price: round2(price),
            cash_down: round2(effectiveDown),
            trade_payoff: round2(tradePayoff),
            jd_power_retail_book: round2(retailBook),
            taxable_amount: round2(taxableAmount),
            sales_tax: salesTax,
            doc_fee: round2(docFee),
            title_license: round2(titleLicense),
            fees_total: feesTotal,
            product_total: optionProductTotal,
            vsc_price: round2(includeVsc ? vscPrice : 0),
            gap_price: round2(includeGap ? gapPrice : 0),
            amount_financed: amountFinanced,
            apr: round2(apr),
            term_months: optionTermMonths,
            monthly_payment: monthlyPmt,
            ltv: retailBook > 0 ? ltv : null,
            fits_program: fitsProgram,
            fail_reasons: failReasons,
            snapshot_json: snapshot,
        },
        { onConflict: "deal_id" }
    );

    if (upsertErr) {
        return NextResponse.json(
            { error: "Failed to save deal structure", details: upsertErr.message },
            { status: 500 }
        );
    }

    return NextResponse.json({
        ok: true,
        deal_id: dealId,
        structure: snapshot,
    });
}
