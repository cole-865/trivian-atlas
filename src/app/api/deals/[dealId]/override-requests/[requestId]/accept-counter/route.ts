import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { getAuthContext } from "@/lib/auth/userRole";
import { buildOverrideStructureSnapshot } from "@/lib/deals/dealOverrideWorkflow";
import { loadDealStructurePageData } from "@/lib/deals/dealStructureLoader";
import {
  acceptLatestDealOverrideCounterOffer,
  approveAcceptedDealOverrideCounterOffer,
  listDealOverrideCounterOffers,
} from "@/lib/deals/dealOverrideServer";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ dealId: string; requestId: string }> }
) {
  const { dealId, requestId } = await params;
  const supabase = await supabaseServer();
  const authContext = await getAuthContext(supabase);

  if (!authContext.realUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: deal, error: dealError, organizationId } =
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

  if (authContext.currentOrganizationMembership?.organizationId !== organizationId) {
    return NextResponse.json(
      { error: "You do not have access to accept counter offers in this account." },
      { status: 403 }
    );
  }

  try {
    const currentState = await loadDealStructurePageData({
      dealId,
      persist: false,
    });

    const accepted = await acceptLatestDealOverrideCounterOffer({
      organizationId,
      dealId,
      requestId,
      acceptedByUserId: authContext.realUser.id,
      currentInputFingerprint: currentState.overrides.currentInputFingerprint,
    });

    const refreshed = await loadDealStructurePageData({
      dealId,
      overrideInputs: accepted.inputs_json,
      persist: true,
    });

    await approveAcceptedDealOverrideCounterOffer({
      organizationId,
      dealId,
      requestId,
      liveStructure: buildOverrideStructureSnapshot({
        vehicleId: refreshed.structure.vehicle.id,
        cashDown: refreshed.structure.structure.cash_down_effective,
        amountFinanced: refreshed.structure.structure.amount_financed,
        monthlyPayment: refreshed.structure.structure.monthly_payment,
        termMonths: refreshed.structure.structure.term_months,
        ltv:
          refreshed.structure.vehicle.jd_power_retail_book > 0
            ? refreshed.structure.structure.ltv
            : null,
        pti: refreshed.structure.structure.pti,
      }),
    });

    const finalState = await loadDealStructurePageData({
      dealId,
      persist: false,
    });

    return NextResponse.json({
      acceptedCounterOfferId: accepted.id,
      ...finalState,
    });
  } catch (error) {
    const offers = await listDealOverrideCounterOffers({
      organizationId,
      dealId,
    }).catch(() => []);
    const latestOffer = offers.find((offer) => offer.deal_override_request_id === requestId) ?? null;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to accept counter offer.",
        rejectionReason: latestOffer?.rejection_reason ?? null,
        counterOfferStatus: latestOffer?.status ?? null,
      },
      { status: 400 }
    );
  }
}
