import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { canAccessStep } from "@/lib/deals/canAccessStep";

function asLabel(v: unknown): "NONE" | "VSC" | "GAP" | "VSC+GAP" | null {
  const s = String(v ?? "").toUpperCase().trim();
  if (s === "NONE" || s === "VSC" || s === "GAP" || s === "VSC+GAP") return s;
  return null;
}

function numOrNull(v: unknown) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

  const access = await canAccessStep({
    supabase,
    step: "deal",
    deal: {
      selected_vehicle_id: data?.vehicle_id ?? null,
    },
  });

  if (!access.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "STEP_BLOCKED",
        redirectTo: access.redirectTo ?? "vehicle",
        reason: access.reason,
      },
      { status: 403 }
    );
  }

  return NextResponse.json({ ok: true, selection: data ?? null });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const vehicle_id = String(body?.vehicle_id ?? "").trim();
  const option_label = asLabel(body?.option_label);
  const include_vsc = !!body?.include_vsc;
  const include_gap = !!body?.include_gap;
  const term_months = numOrNull(body?.term_months);
  const monthly_payment = numOrNull(body?.monthly_payment);

  if (!vehicle_id) {
    return NextResponse.json({ error: "vehicle_id is required" }, { status: 400 });
  }
  if (!option_label) {
    return NextResponse.json({ error: "option_label is invalid" }, { status: 400 });
  }
  if (term_months == null) {
    return NextResponse.json({ error: "term_months is required" }, { status: 400 });
  }
  if (monthly_payment == null) {
    return NextResponse.json({ error: "monthly_payment is required" }, { status: 400 });
  }

  const cash_down = numOrNull(body?.cash_down);

  const supabase = await supabaseServer();
  const { data: underwritingResult, error: underwritingErr } = await supabase
    .from("underwriting_results")
    .select("decision")
    .eq("deal_id", dealId)
    .eq("stage", "bureau_precheck")
    .maybeSingle();

  if (underwritingErr) {
    return NextResponse.json(
      { error: "Failed to load underwriting result", details: underwritingErr.message },
      { status: 500 }
    );
  }

  const access = await canAccessStep({
    supabase,
    step: "vehicle",
    deal: {},
    underwriting: {
      decision: underwritingResult?.decision ?? null,
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

  return NextResponse.json({ ok: true, selection: data });
}
