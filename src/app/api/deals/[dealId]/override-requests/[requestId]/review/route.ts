import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { getAuthContext } from "@/lib/auth/userRole";
import { reviewDealOverrideRequest } from "@/lib/deals/dealOverrideServer";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string; requestId: string }> }
) {
  const { dealId, requestId } = await params;
  const supabase = await supabaseServer();
  const authContext = await getAuthContext(supabase);

  if (!authContext.realUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const status = String(body?.status ?? "").trim().toLowerCase();
  const reviewNote = String(body?.review_note ?? "").trim() || null;

  if (status !== "approved" && status !== "denied") {
    return NextResponse.json({ error: "Invalid review status." }, { status: 400 });
  }

  const { data: deal, error: dealError, organizationId } =
    await getDealForCurrentOrganization<{
      customer_name: string | null;
      id: string;
    }>(supabase, dealId, "id, customer_name");

  if (!organizationId) {
    return NextResponse.json(
      { error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

  if (dealError) {
    return NextResponse.json(
      { error: "Failed to load deal", details: dealError.message },
      { status: 500 }
    );
  }

  if (!deal?.id) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  if (
    authContext.currentOrganizationMembership?.organizationId !== organizationId ||
    !authContext.currentOrganizationMembership.canApproveDealOverrides
  ) {
    return NextResponse.json(
      { error: "You do not have override approval authority in this account." },
      { status: 403 }
    );
  }

  try {
    const request = await reviewDealOverrideRequest({
      organizationId,
      dealId,
      requestId,
      reviewedByUserId: authContext.realUser.id,
      status,
      reviewNote,
      customerName: deal.customer_name,
    });

    return NextResponse.json({ ok: true, request });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to review override request.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
