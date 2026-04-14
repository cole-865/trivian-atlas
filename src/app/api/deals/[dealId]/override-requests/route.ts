import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";
import { getAuthContext } from "@/lib/auth/userRole";
import { hasDealershipPermission } from "@/lib/auth/dealershipPermissions";
import { buildOverrideStructureSnapshot, normalizeDealOverrideBlockerCode } from "@/lib/deals/dealOverrideWorkflow";
import { buildDealOverrideRequestNote } from "@/lib/deals/dealOverrideSummary";
import { createDealOverrideRequest } from "@/lib/deals/dealOverrideServer";

type DealStructureRow = {
  amount_financed: number | null;
  cash_down: number | null;
  fail_reasons: unknown;
  ltv: number | null;
  monthly_payment: number | null;
  snapshot_json: {
    assumptions?: {
      max_vehicle_price?: number | null;
    } | null;
    structure?: {
      additional_down_breakdown?: {
        amount_financed?: number | null;
        ltv?: number | null;
        min_down?: number | null;
        pti?: number | null;
      } | null;
      amount_financed?: number | null;
      sale_price?: number | null;
    } | null;
    vehicle?: {
      make?: string | null;
      model?: string | null;
      odometer?: number | null;
      stock_number?: string | null;
      year?: number | null;
    } | null;
  } | null;
  term_months: number | null;
  vehicle_id: string | null;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();
  const authContext = await getAuthContext(supabase);

  if (!authContext.realUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "request").trim().toLowerCase();
  const blockerCode = normalizeDealOverrideBlockerCode(
    String(body?.blocker_code ?? "")
  );
  const requestedNote = String(body?.requested_note ?? "").trim();
  const isCounterOfferDraft = body?.counter_offer_draft === true;

  if (!blockerCode) {
    return NextResponse.json({ error: "Invalid blocker code." }, { status: 400 });
  }

  if (action !== "request" && action !== "approve") {
    return NextResponse.json({ error: "Invalid override action." }, { status: 400 });
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

  if (authContext.currentOrganizationMembership?.organizationId !== organizationId) {
    return NextResponse.json(
      { error: "You cannot request overrides in this account." },
      { status: 403 }
    );
  }

  const canApprove =
    authContext.currentOrganizationMembership?.organizationId === organizationId &&
    (await hasDealershipPermission(authContext, "approve_overrides"));

  if (action === "approve" && !canApprove) {
    return NextResponse.json(
      { error: "You do not have override approval authority in this account." },
      { status: 403 }
    );
  }

  if (!requestedNote && !(action === "request" && isCounterOfferDraft && canApprove)) {
    return NextResponse.json(
      { error: "Override notes are required." },
      { status: 400 }
    );
  }

  const { data: structure, error: structureError } = await scopeQueryToOrganization(
    supabase
      .from("deal_structure")
      .select(
        "vehicle_id, cash_down, amount_financed, monthly_payment, term_months, ltv, fail_reasons, snapshot_json"
      ),
    organizationId
  )
    .eq("deal_id", dealId)
    .maybeSingle();

  if (structureError) {
    return NextResponse.json(
      { error: "Failed to load live deal structure", details: structureError.message },
      { status: 500 }
    );
  }

  const liveStructure = structure as DealStructureRow | null;
  if (!liveStructure?.vehicle_id) {
    return NextResponse.json(
      { error: "No live deal structure is available for override requests." },
      { status: 400 }
    );
  }

  const vehicleParts = [
    liveStructure.snapshot_json?.vehicle?.year,
    liveStructure.snapshot_json?.vehicle?.make,
    liveStructure.snapshot_json?.vehicle?.model,
    liveStructure.snapshot_json?.vehicle?.stock_number
      ? `#${liveStructure.snapshot_json.vehicle.stock_number}`
      : null,
  ].filter(Boolean);

  const overrideRequestNote = buildDealOverrideRequestNote({
    blockerCode,
    customerName: deal.customer_name,
    snapshot: liveStructure.snapshot_json,
    userNote: requestedNote,
  });

  try {
    const request = await createDealOverrideRequest({
      organizationId,
      dealId,
      blockerCode,
      requestedByUserId: authContext.realUser.id,
      requestedNote: overrideRequestNote,
      customerName: deal.customer_name,
      vehicleSummary: vehicleParts.join(" ") || liveStructure.vehicle_id,
      failReasons: liveStructure.fail_reasons,
      liveStructure: buildOverrideStructureSnapshot({
        vehicleId: liveStructure.vehicle_id,
        cashDown: liveStructure.cash_down,
        amountFinanced: liveStructure.amount_financed,
        monthlyPayment: liveStructure.monthly_payment,
        termMonths: liveStructure.term_months,
        ltv: liveStructure.ltv,
        pti: null,
      }),
      directApproval:
        action === "approve"
          ? {
              reviewedByUserId: authContext.realUser.id,
              reviewNote: "Approved directly by authorized user from the deal screen.",
            }
          : null,
    });

    return NextResponse.json({ ok: true, request });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create override request.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
