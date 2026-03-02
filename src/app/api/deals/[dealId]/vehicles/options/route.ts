import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

function round2(n: number) {
  return Number((n || 0).toFixed(2));
}

function monthlyPayment(principal: number, apr: number, termMonths: number): number {
  const P = Number(principal);
  const n = Number(termMonths);
  const r = Number(apr) / 100 / 12;

  if (!P || P <= 0) return 0;
  if (!n || n <= 0) return 0;

  // Edge case: 0% APR
  if (r === 0) return round2(P / n);

  const pow = Math.pow(1 + r, n);
  const payment = P * (r * pow) / (pow - 1);
  return round2(payment);
}

function principalFromPayment(payment: number, apr: number, termMonths: number): number {
  const PMT = Number(payment);
  const n = Number(termMonths);
  const r = Number(apr) / 100 / 12;

  if (!PMT || PMT <= 0) return 0;
  if (!n || n <= 0) return 0;

  if (r === 0) return round2(PMT * n);

  // P = PMT * (1 - (1+r)^-n) / r
  const P = PMT * (1 - Math.pow(1 + r, -n)) / r;
  return round2(P);
}

// Tax formula (matches your config fields):
// tax = price * tax_rate_main + min(price, tax_add_base) * tax_add_rate
function estimateTax(price: number, taxRateMain: number, taxAddBase: number, taxAddRate: number) {
  const p = Number(price) || 0;
  const main = p * (Number(taxRateMain) || 0);
  const add = Math.min(p, Number(taxAddBase) || 0) * (Number(taxAddRate) || 0);
  return round2(main + add);
}

type PayOption = {
  label: "NONE" | "VSC" | "GAP" | "VSC+GAP";
  include_vsc: boolean;
  include_gap: boolean;
  product_total: number;
  amount_financed_est: number;
  monthly_payment: number;
  fits_cap: boolean;
  additional_down_needed: number; // extra down needed to get to cap
};

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

  // 1) Deal basics (max_payment + down/trade)
  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .select("id, max_payment, cash_down, trade_payoff, has_trade")
    .eq("id", dealId)
    .single();

  if (dealErr) {
    return NextResponse.json({ error: "Failed to load deal", details: dealErr.message }, { status: 500 });
  }

  const maxPayment = Number(deal?.max_payment ?? 0);
  const cashDown = cashDownOverride != null ? Number(cashDownOverride) : Number(deal?.cash_down ?? 0);
  const tradePayoff = Number(deal?.trade_payoff ?? 0);

  // (for now) assume trade equity = 0; payoff increases required cash to close in real life.
  // we’ll add trade ACV later when you want it.
  const effectiveDown = round2(cashDown); // keep simple

  // 2) Underwriting inputs (APR + term)
  const { data: uw } = await supabase
    .from("underwriting_inputs")
    .select("interest_rate_apr, term_months, max_payment_pct, vsc_price, gap_price")
    .eq("deal_id", dealId)
    .maybeSingle();

  // 3) Config (fees/taxes + product pricing fallbacks)
  const { data: cfg } = await supabase
    .from("trivian_config")
    .select("apr, payment_cap_pct, tax_rate_main, tax_add_base, tax_add_rate, doc_fee, title_license, vsc_price, gap_price")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const apr = Number(uw?.interest_rate_apr ?? cfg?.apr ?? 26.99);
  const termMonths = Number(uw?.term_months ?? 48);

  const taxRateMain = Number(cfg?.tax_rate_main ?? 0.07);
  const taxAddBase = Number(cfg?.tax_add_base ?? 320);
  const taxAddRate = Number(cfg?.tax_add_rate ?? 0.07);

  const docFee = Number(cfg?.doc_fee ?? 895.5);
  const titleLicense = Number(cfg?.title_license ?? 0);

  const vscPrice = Number(uw?.vsc_price ?? cfg?.vsc_price ?? 1799);
  const gapPrice = Number(uw?.gap_price ?? cfg?.gap_price ?? 599);

  // 4) Inventory list
  const { data: vehicles, error: invErr } = await supabase
    .from("trivian_inventory")
    .select("id, stock_number, vin, year, make, model, odometer, status, asking_price, date_in_stock")
    .order("date_in_stock", { ascending: true })
    .range(offset, offset + limit - 1);

  if (invErr) {
    return NextResponse.json({ error: "Failed to load inventory", details: invErr.message }, { status: 500 });
  }

  const optionsTemplate: Array<{ label: PayOption["label"]; vsc: boolean; gap: boolean; productTotal: number }> = [
    { label: "VSC+GAP", vsc: true, gap: true, productTotal: round2(vscPrice + gapPrice) },
    { label: "VSC", vsc: true, gap: false, productTotal: round2(vscPrice) },
    { label: "GAP", vsc: false, gap: true, productTotal: round2(gapPrice) },
    { label: "NONE", vsc: false, gap: false, productTotal: 0 },
  ];

  const rows = (vehicles ?? []).map((v) => {
    const price = Number(v.asking_price ?? 0);
    const tax = estimateTax(price, taxRateMain, taxAddBase, taxAddRate);
    const baseFees = round2(docFee + titleLicense + tax);

    const payOptions: PayOption[] = optionsTemplate.map((ot) => {
      // Total amount financed estimate
      // amount financed = price + fees + products - down
      const amountFinanced = round2(price + baseFees + ot.productTotal - effectiveDown);

      const pmt = monthlyPayment(amountFinanced, apr, termMonths);

      const fits = maxPayment > 0 ? pmt <= maxPayment : true;

      let additionalDown = 0;
      if (maxPayment > 0 && !fits) {
        const principalAllowed = principalFromPayment(maxPayment, apr, termMonths);
        additionalDown = round2(Math.max(0, amountFinanced - principalAllowed));
      }

      return {
        label: ot.label,
        include_vsc: ot.vsc,
        include_gap: ot.gap,
        product_total: ot.productTotal,
        amount_financed_est: amountFinanced,
        monthly_payment: pmt,
        fits_cap: fits,
        additional_down_needed: additionalDown,
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
      },
      assumptions: {
        apr,
        term_months: termMonths,
        cash_down_used: effectiveDown,
        trade_payoff: tradePayoff,
        fees_est: baseFees,
        tax_est: tax,
        doc_fee: docFee,
        title_license: titleLicense,
        vsc_price: vscPrice,
        gap_price: gapPrice,
        max_payment_cap: maxPayment,
      },
      payment_options: payOptions,
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