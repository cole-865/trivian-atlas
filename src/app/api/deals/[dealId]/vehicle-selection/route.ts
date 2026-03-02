import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

function asLabel(v: any): "NONE" | "VSC" | "GAP" | "VSC+GAP" | null {
  const s = String(v ?? "").toUpperCase().trim();
  if (s === "NONE" || s === "VSC" || s === "GAP" || s === "VSC+GAP") return s;
  return null;
}

function numOrNull(v: any) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function numRequired(v: any, name: string) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("deal_vehicle_selection")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to load selection", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, selection: data ?? null });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const vehicle_id = String(body?.vehicle_id ?? "").trim();
  const option_label = asLabel(body?.option_label);
  const include_vsc = !!body?.include_vsc;
  const include_gap = !!body?.include_gap;

  if (!vehicle_id) {
    return NextResponse.json({ error: "vehicle_id is required" }, { status: 400 });
  }
  if (!option_label) {
    return NextResponse.json({ error: "option_label is invalid" }, { status: 400 });
  }

  let term_months: number;
  let monthly_payment: number;
  try {
    term_months = Math.round(numRequired(body?.term_months, "term_months"));
    monthly_payment = numRequired(body?.monthly_payment, "monthly_payment");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid numbers" }, { status: 400 });
  }

  const cash_down = numOrNull(body?.cash_down);

  const supabase = await supabaseServer();

  const nowIso = new Date().toISOString();

  const payload = {
    deal_id: dealId,
    vehicle_id,
    option_label,
    include_vsc,
    include_gap,
    term_months,
    monthly_payment,
    cash_down,
    updated_at: nowIso,
  };

  const { data, error } = await supabase
    .from("deal_vehicle_selection")
    .upsert(payload, { onConflict: "deal_id" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to save selection", details: error.message },
      { status: 500 }
    );
  }

  // Optional: keep deals.cash_down in sync if provided
  if (cash_down != null) {
    const { error: dErr } = await supabase
      .from("deals")
      .update({ cash_down })
      .eq("id", dealId);

    if (dErr) {
      return NextResponse.json(
        {
          error: "Selection saved but failed to update deals.cash_down",
          details: dErr.message,
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, selection: data });
}