import { getAuthContext } from "@/lib/auth/userRole";
import { hasDealershipPermission } from "@/lib/auth/dealershipPermissions";
import { loadDealDecisionAssistReview } from "@/lib/deals/dealDecisionAssist";
import { buildOverrideStructureSnapshot } from "@/lib/deals/dealOverrideWorkflow";
import { loadDealOverrideSnapshot } from "@/lib/deals/dealOverrideServer";
import {
  buildDealStructureInputFingerprint,
  computeDealStructureState,
  loadDealStructureContext,
  persistDealStructureState,
  type DealStructureInputsRecord,
} from "@/lib/deals/dealStructureEngine";
import { getDealStructureSnapshotAiReview } from "@/lib/deals/dealStructureSnapshot";
import { supabaseServer } from "@/lib/supabase/server";

async function loadLatestSavedAiReview(args: {
  supabase: Awaited<ReturnType<typeof supabaseServer>>;
  organizationId: string;
  dealId: string;
}) {
  const { data, error } = await args.supabase
    .from("deal_structure")
    .select("snapshot_json")
    .eq("organization_id", args.organizationId)
    .eq("deal_id", args.dealId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load saved AI review: ${error.message}`);
  }

  return getDealStructureSnapshotAiReview(
    (data as { snapshot_json?: unknown } | null)?.snapshot_json
  );
}

export async function loadDealStructurePageData(args: {
  dealId: string;
  includeAiReview?: boolean;
  overrideInputs?: Partial<DealStructureInputsRecord> | null;
  persist?: boolean;
}) {
  const supabase = await supabaseServer();
  const context = await loadDealStructureContext(supabase, args.dealId);
  const inputs = {
    ...context.inputs,
    ...(args.overrideInputs ?? {}),
    organization_id: context.organizationId,
    deal_id: args.dealId,
    vehicle_id: context.inputs.vehicle_id,
  } satisfies DealStructureInputsRecord;

  const computed = computeDealStructureState({
    dealId: args.dealId,
    deal: context.deal,
    inputs,
    underwriting: context.underwriting,
    underwritingInputs: context.underwritingInputs,
    vehicle: context.vehicle,
    vehicleTermPolicies: context.vehicleTermPolicies,
  });

  const authContext = await getAuthContext(supabase);
  const canApproveOverrides =
    authContext.currentOrganizationId === context.organizationId &&
    (await hasDealershipPermission(authContext, "approve_overrides"));
  const overrides = await loadDealOverrideSnapshot({
    organizationId: context.organizationId,
    dealId: args.dealId,
    customerName: context.customerName,
    currentInputFingerprint: buildDealStructureInputFingerprint(inputs),
    failReasons: computed.structure.fail_reasons,
    liveStructure: buildOverrideStructureSnapshot({
      vehicleId: computed.vehicle.id,
      cashDown: computed.structure.cash_down_effective,
      amountFinanced: computed.structure.amount_financed,
      monthlyPayment: computed.structure.monthly_payment,
      termMonths: computed.structure.term_months,
      ltv: computed.vehicle.jd_power_retail_book > 0 ? computed.structure.ltv : null,
      pti: computed.structure.pti,
    }),
  });

  const aiReview = args.includeAiReview
    ? await loadDealDecisionAssistReview({
        supabase,
        context,
        computed,
        overrides: {
          currentFingerprint: overrides.currentFingerprint,
          rawBlockers: overrides.rawBlockers,
          effectiveBlockers: overrides.effectiveBlockers,
          requests: overrides.requests.map((request) => ({
            id: request.id,
            blocker_code: request.blocker_code,
            status: request.status,
          })),
        },
      })
    : await loadLatestSavedAiReview({
        supabase,
        organizationId: context.organizationId,
        dealId: args.dealId,
      });

  if (args.persist !== false) {
    await persistDealStructureState({
      supabase,
      organizationId: context.organizationId,
      dealId: args.dealId,
      inputs,
      computed,
      aiReview,
    });
  }

  return {
    ok: true,
    deal_id: args.dealId,
    customerName: context.customerName ?? null,
    selection: {
      deal_id: context.selection.deal_id,
      vehicle_id: inputs.vehicle_id,
      option_label: computed.selection.option_label,
      include_vsc: inputs.include_vsc,
      include_gap: inputs.include_gap,
      term_months: computed.structure.term_months,
      monthly_payment: computed.structure.monthly_payment,
      pti: computed.structure.pti,
      cash_down: inputs.cash_down,
    },
    underwriting: context.underwriting,
    structure: {
      deal_id: args.dealId,
      selection: computed.selection,
      vehicle: computed.vehicle,
      structure: computed.structure,
      assumptions: computed.assumptions,
      ai_review: aiReview,
    },
    structureInputs: inputs,
    overrides: {
      canApprove: canApproveOverrides,
      canAcceptCounterOffers:
        authContext.currentOrganizationMembership?.organizationId === context.organizationId,
      currentFingerprint: overrides.currentFingerprint,
      currentInputFingerprint: buildDealStructureInputFingerprint(inputs),
      rawBlockers: overrides.rawBlockers,
      effectiveBlockers: overrides.effectiveBlockers,
      blockerStates: overrides.blockerStates,
      requests: overrides.requests,
      counterOffers: overrides.counterOffers,
      latestCounterOffer: overrides.latestCounterOffer,
    },
  };
}
