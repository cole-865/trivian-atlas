import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { getAuthContext } from "@/lib/auth/userRole";
import type { DealStructureInputsRecord } from "@/lib/deals/dealStructureEngine";
import { loadDealStructurePageData } from "@/lib/deals/dealStructureLoader";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string; requestId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();
  const authContext = await getAuthContext(supabase);

  if (!authContext.realUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId, data: deal, error: dealError } =
    await getDealForCurrentOrganization<{ id: string }>(supabase, dealId, "id");

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

  const body = await req.json().catch(() => ({}));
  const counterInputs = body?.counter_offer?.inputs as Partial<DealStructureInputsRecord> | undefined;

  if (!counterInputs) {
    return NextResponse.json(
      { error: "Counter offer inputs are required." },
      { status: 400 }
    );
  }

  try {
    const preview = await loadDealStructurePageData({
      dealId,
      overrideInputs: counterInputs,
      persist: false,
    });

    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to preview counter offer.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
