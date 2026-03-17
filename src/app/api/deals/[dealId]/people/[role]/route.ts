import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const ALLOWED_ROLES = new Set(["primary", "co"] as const);

function bool(v: unknown) {
  return v === true;
}

function numOrNull(v: unknown) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function buildCustomerName(firstName: unknown, lastName: unknown) {
  const first = strOrNull(firstName) ?? "";
  const last = strOrNull(lastName) ?? "";
  const full = `${first} ${last}`.trim();
  return full.length ? full : null;
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ dealId: string; role: string }> }
) {
  const { dealId, role } = await context.params;

  if (!ALLOWED_ROLES.has(role as any)) {
    return NextResponse.json(
      { ok: false, error: "Invalid role", allowed: Array.from(ALLOWED_ROLES) },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));

  const supabase = await supabaseServer();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json(
      { ok: false, error: "Auth error", details: userErr?.message ?? "Not authenticated" },
      { status: 401 }
    );
  }

  const payload = {
    deal_id: dealId,
    role,

    first_name: strOrNull(body.first_name),
    last_name: strOrNull(body.last_name),
    phone: strOrNull(body.phone),
    email: strOrNull(body.email),

    address_line1: strOrNull(body.address_line1),
    city: strOrNull(body.city),
    state: strOrNull(body.state),
    zip: strOrNull(body.zip),

    residence_months: numOrNull(body.residence_months),

    banking_checking: bool(body.banking_checking),
    banking_savings: bool(body.banking_savings),
    banking_prepaid: bool(body.banking_prepaid),
  };

  const { data, error } = await supabase
    .from("deal_people")
    .upsert(payload, { onConflict: "deal_id,role" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to save person",
        details: error.message,
        hint: error.hint,
      },
      { status: 500 }
    );
  }

  if (role === "primary") {
    const customer_name = buildCustomerName(data.first_name, data.last_name);

    const { error: dealErr } = await supabase
      .from("deals")
      .update({ customer_name })
      .eq("id", dealId);

    if (dealErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "Saved person but failed to sync deal name",
          details: dealErr.message,
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, person: data });
}