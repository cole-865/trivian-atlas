import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  assertDealInCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";

type CustomerBody = {
  customer_name?: unknown;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;

  let body: CustomerBody;
  try {
    body = (await req.json()) as CustomerBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const customer_name = String(body?.customer_name ?? "").trim();

  // ✅ Server-side guardrail (cannot be bypassed)
  if (!customer_name) {
    return NextResponse.json(
      { error: "Customer name is required." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const scopedDeal = await assertDealInCurrentOrganization(supabase, dealId);

  if (!scopedDeal.organizationId) {
    return NextResponse.json(
      { error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

  if (scopedDeal.error) {
    return NextResponse.json(
      { error: "Failed to load deal", details: scopedDeal.error.message },
      { status: 500 }
    );
  }

  if (!scopedDeal.data) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // If you want, add other fields here too later (phone, email, address, etc.)
  const { error } = await supabase
    .from("deals")
    .update({ customer_name })
    .eq("id", dealId)
    .eq("organization_id", scopedDeal.organizationId);

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
