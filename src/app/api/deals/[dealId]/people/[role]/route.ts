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

  if (userErr) {
    return NextResponse.json(
      { ok: false, error: "Auth error", details: userErr.message },
      { status: 401 }
    );
  }

  // Keep it flexible: RLS may require user_id, but you also said "everyone can see everything for now".
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

  // Upsert by (deal_id, role). This requires a unique constraint on (deal_id, role).
  const { data, error } = await supabase
    .from("deal_people")
    .upsert(payload, { onConflict: "deal_id,role" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Failed to save person", details: error.message, hint: error.hint },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, person: data });
}