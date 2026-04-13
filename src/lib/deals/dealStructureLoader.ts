import { getAuthContext } from "@/lib/auth/userRole";
import { buildOverrideStructureSnapshot } from "@/lib/deals/dealOverrideWorkflow";
import { loadDealOverrideSnapshot } from "@/lib/deals/dealOverrideServer";
import {
  buildDealStructureInputFingerprint,
  computeDealStructureState,
  loadDealStructureContext,
  persistDealStructureState,
  type DealStructureInputsRecord,
} from "@/lib/deals/dealStructureEngine";
import { supabaseServer } from "@/lib/supabase/server";

export async function loadDealStructurePageData(args: {
  dealId: string;
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

  if (args.persist !== false) {
    await persistDealStructureState({
      supabase,
      organizationId: context.organizationId,
      dealId: args.dealId,
      inputs,
      computed,
    });
  }

  const authContext = await getAuthContext(supabase);
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
    },
    structureInputs: inputs,
    overrides: {
      canApprove: !!authContext.currentOrganizationMembership?.canApproveDealOverrides,
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
