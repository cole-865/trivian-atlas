import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { getAuthContext } from "@/lib/auth/userRole";
import { hasDealershipPermission } from "@/lib/auth/dealershipPermissions";
import { buildDealStructureInputFingerprint, type DealStructureInputsRecord } from "@/lib/deals/dealStructureEngine";
import { loadDealStructurePageData } from "@/lib/deals/dealStructureLoader";
import {
  reviewDealOverrideRequest,
  type DealOverrideCounterType,
} from "@/lib/deals/dealOverrideServer";

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
  const counterType = String(body?.counter_type ?? "").trim().toLowerCase() || null;
  const counterInputs = body?.counter_offer?.inputs as Partial<DealStructureInputsRecord> | undefined;

  if (status !== "approved" && status !== "denied" && status !== "countered") {
    return NextResponse.json({ error: "Invalid review status." }, { status: 400 });
  }

  if ((status === "denied" || status === "countered") && !reviewNote) {
    return NextResponse.json(
      { error: "A review note is required for this review action." },
      { status: 400 }
    );
  }

  const { data: deal, error: dealError, organizationId } =
    await getDealForCurrentOrganization<{
      customer_name: string | null;
      id: string;
      submitted_by: string | null;
      user_id: string | null;
    }>(supabase, dealId, "id, customer_name, user_id, submitted_by");

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

  const canApprove =
    authContext.currentOrganizationMembership?.organizationId === organizationId &&
    (await hasDealershipPermission(authContext, "approve_overrides"));

  if (!canApprove) {
    return NextResponse.json(
      { error: "You do not have override approval authority in this account." },
      { status: 403 }
    );
  }

  try {
    let counterOffer = null;
    if (status === "countered") {
      if (
        !counterInputs ||
        (counterType !== "improve_approval" &&
          counterType !== "reduce_risk" &&
          counterType !== "pricing_adjustment")
      ) {
        return NextResponse.json(
          { error: "Counter offer inputs and counter_type are required." },
          { status: 400 }
        );
      }

      const currentState = await loadDealStructurePageData({
        dealId,
        persist: false,
      });

      const preview = await loadDealStructurePageData({
        dealId,
        overrideInputs: counterInputs,
        persist: false,
      });

      counterOffer = {
        counterType: counterType as DealOverrideCounterType,
        inputs: {
          ...preview.structureInputs,
          option_label: preview.structure.selection.option_label,
        } satisfies DealStructureInputsRecord,
        outputsSnapshot: preview.structure,
        baseStructureFingerprint: currentState.overrides.currentInputFingerprint,
        proposalStructureFingerprint: buildDealStructureInputFingerprint({
          ...preview.structureInputs,
          option_label: preview.structure.selection.option_label,
        } satisfies DealStructureInputsRecord),
      };
    }

    const result = await reviewDealOverrideRequest({
      organizationId,
      dealId,
      requestId,
      reviewedByUserId: authContext.realUser.id,
      status: status as "approved" | "denied" | "countered",
      reviewNote,
      customerName: deal.customer_name,
      salespersonUserId: deal.user_id ?? deal.submitted_by ?? null,
      counterOffer,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to review override request.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
