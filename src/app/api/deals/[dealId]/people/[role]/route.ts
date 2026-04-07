import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { buildCustomerName } from "@/lib/deals/customerName";
import {
  assertDealInCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";

const ALLOWED_ROLES = new Set(["primary", "co"] as const);

function bool(v: unknown) {
  return v === true;
}

function strOrNull(v: unknown) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function isValidDateString(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function monthsSinceMoveIn(moveInDate: string | null) {
  if (!moveInDate || !isValidDateString(moveInDate)) return null;

  const [y, m, d] = moveInDate.split("-").map(Number);
  const move = new Date(y, m - 1, d);
  const today = new Date();

  if (Number.isNaN(move.getTime())) return null;
  if (move > today) return 0;

  let months =
    (today.getFullYear() - move.getFullYear()) * 12 +
    (today.getMonth() - move.getMonth());

  if (today.getDate() < move.getDate()) {
    months -= 1;
  }

  return Math.max(0, months);
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ dealId: string; role: string }> }
) {
  const { dealId, role } = await context.params;

  if (!ALLOWED_ROLES.has(role as "primary" | "co")) {
    return NextResponse.json(
      { ok: false, error: "Invalid role", allowed: Array.from(ALLOWED_ROLES) },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));

  const supabase = await supabaseServer();
  const scopedDeal = await assertDealInCurrentOrganization(supabase, dealId);

  if (!scopedDeal.organizationId) {
    return NextResponse.json(
      { ok: false, error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

  if (scopedDeal.error) {
    return NextResponse.json(
      { ok: false, error: "Failed to load deal", details: scopedDeal.error.message },
      { status: 500 }
    );
  }

  if (!scopedDeal.data) {
    return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
  }
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: "Auth error",
        details: userErr?.message ?? "Not authenticated",
      },
      { status: 401 }
    );
  }

  const move_in_date = strOrNull(body.move_in_date);
  const residence_months = monthsSinceMoveIn(move_in_date);

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

    move_in_date,
    residence_months,

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

  return NextResponse.json({
    ok: true,
    person: data,
    customer_name:
      role === "primary" ? buildCustomerName(data.first_name, data.last_name) : null,
  });
}
