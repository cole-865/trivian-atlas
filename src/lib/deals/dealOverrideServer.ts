import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.generated";
import type { DealStructureInputsRecord } from "@/lib/deals/dealStructureEngine";
import type {
  DealOverrideBlockerCode,
  DealOverrideStructureSnapshot,
} from "@/lib/deals/dealOverrideFingerprint";
import {
  buildDealOverrideFingerprint,
} from "@/lib/deals/dealOverrideFingerprint";
import {
  evaluateDealOverrides,
  getStaleReasonForRequest,
  type DealOverrideRequestLike,
  type DealOverrideRequestStatus,
} from "@/lib/deals/dealOverrideWorkflow";
import { createAppNotifications } from "@/lib/notifications/appNotifications";
import {
  sendDealOverrideApprovedEmail,
  sendDealOverrideCounterOfferEmail,
  sendDealOverrideDeniedEmail,
  sendDealOverrideRequestedEmail,
  sendDealOverrideStaleEmail,
} from "@/lib/email/notifications";
import { listActiveOrganizationUsersWithPermission } from "@/lib/auth/dealershipPermissions";
import { getNotificationSettingsForOrganization } from "@/lib/settings/dealershipSettings";

export type DealOverrideRequestRecord = {
  id: string;
  organization_id: string;
  deal_id: string;
  blocker_code: DealOverrideBlockerCode;
  status: DealOverrideRequestStatus;
  requested_by: string | null;
  requested_note: string | null;
  requested_at: string;
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  vehicle_id: string | null;
  cash_down_snapshot: number | null;
  amount_financed_snapshot: number | null;
  monthly_payment_snapshot: number | null;
  term_months_snapshot: number | null;
  ltv_snapshot: number | null;
  pti_snapshot: number | null;
  structure_fingerprint: string;
  stale_reason: string | null;
  status_changed_at: string;
  created_at: string;
  updated_at: string;
};

export type DealOverrideCounterType =
  | "improve_approval"
  | "reduce_risk"
  | "pricing_adjustment";

export type DealOverrideCounterOfferStatus =
  | "active"
  | "accepted_counter"
  | "stale"
  | "superseded"
  | "rejected_acceptance";

export type DealOverrideCounterOfferRecord = {
  id: string;
  deal_override_request_id: string;
  organization_id: string;
  deal_id: string;
  version_number: number;
  counter_type: DealOverrideCounterType;
  review_note: string;
  reviewed_by: string | null;
  reviewed_at: string;
  base_structure_fingerprint: string;
  proposal_structure_fingerprint: string;
  inputs_json: DealStructureInputsRecord;
  outputs_snapshot_json: Record<string, unknown>;
  status: DealOverrideCounterOfferStatus;
  stale_reason: string | null;
  rejection_reason: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  created_at: string;
  updated_at: string;
};

type UserProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
};

type CounterOfferOutputSnapshot = {
  structure?: {
    amount_financed?: number | null;
    cash_down_effective?: number | null;
    ltv?: number | null;
    monthly_payment?: number | null;
    term_months?: number | null;
  } | null;
  vehicle?: {
    id?: string | null;
  } | null;
};

function toRequestLike(
  request: DealOverrideRequestRecord
): DealOverrideRequestLike {
  return {
    blockerCode: request.blocker_code,
    status: request.status,
    structureFingerprint: request.structure_fingerprint,
    vehicleId: request.vehicle_id,
    staleReason: request.stale_reason,
    requestedAt: request.requested_at,
  };
}

async function getUserProfiles(userIds: string[]) {
  const admin = createAdminClient();
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  const lookup = new Map<string, UserProfileRow>();

  if (!uniqueIds.length) {
    return lookup;
  }

  const { data, error } = await admin
    .from("user_profiles")
    .select("id, email, full_name, is_active")
    .in("id", uniqueIds);

  if (error) {
    throw new Error(`Failed to load notification user profiles: ${error.message}`);
  }

  for (const row of (data ?? []) as UserProfileRow[]) {
    lookup.set(row.id, row);
  }

  return lookup;
}

function getCounterOfferEmailStructure(outputsSnapshot: Record<string, unknown>) {
  const snapshot = outputsSnapshot as CounterOfferOutputSnapshot;
  const structure = snapshot.structure ?? null;

  return {
    amountFinanced: structure?.amount_financed ?? null,
    cashDown: structure?.cash_down_effective ?? null,
    ltv: structure?.ltv ?? null,
    monthlyPayment: structure?.monthly_payment ?? null,
    pti: null,
    termMonths: structure?.term_months ?? null,
  };
}

function getCounterOfferOverrideSnapshot(
  outputsSnapshot: Record<string, unknown>
): DealOverrideStructureSnapshot {
  const snapshot = outputsSnapshot as CounterOfferOutputSnapshot;
  const structure = snapshot.structure ?? null;

  return {
    vehicleId: snapshot.vehicle?.id ?? null,
    cashDown: structure?.cash_down_effective ?? null,
    amountFinanced: structure?.amount_financed ?? null,
    monthlyPayment: structure?.monthly_payment ?? null,
    termMonths: structure?.term_months ?? null,
    ltv: structure?.ltv ?? null,
    pti: null,
  };
}

export async function loadOverrideAuthorityRecipients(organizationId: string) {
  const userIds = await listActiveOrganizationUsersWithPermission(
    organizationId,
    "approve_overrides"
  );
  const profileLookup = await getUserProfiles(userIds);

  return userIds
    .map((userId) => {
      const profile = profileLookup.get(userId);
      if (!profile?.is_active || !profile.email) {
        return null;
      }

      return {
        userId,
        email: profile.email,
        fullName: profile.full_name,
      };
    })
    .filter(
      (
        recipient
      ): recipient is { userId: string; email: string; fullName: string | null } =>
        !!recipient
    );
}

export async function listDealOverrideRequests(args: {
  organizationId: string;
  dealId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deal_override_requests")
    .select("*")
    .eq("organization_id", args.organizationId)
    .eq("deal_id", args.dealId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load deal override requests: ${error.message}`);
  }

  return (data ?? []) as DealOverrideRequestRecord[];
}

export async function loadDealOverrideAudit(args: {
  organizationId: string;
  dealId: string;
}) {
  const requests = await listDealOverrideRequests(args);
  const userIds = requests.flatMap((request) => [
    request.requested_by ?? "",
    request.reviewed_by ?? "",
  ]);
  const lookup = await getUserProfiles(userIds);

  return requests.map((request) => ({
    ...request,
    requesterName:
      lookup.get(request.requested_by ?? "")?.full_name ||
      lookup.get(request.requested_by ?? "")?.email ||
      request.requested_by ||
      "Unknown user",
    reviewerName:
      lookup.get(request.reviewed_by ?? "")?.full_name ||
      lookup.get(request.reviewed_by ?? "")?.email ||
      request.reviewed_by ||
      null,
  }));
}

export async function listDealOverrideCounterOffers(args: {
  organizationId: string;
  dealId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deal_override_counter_offers")
    .select("*")
    .eq("organization_id", args.organizationId)
    .eq("deal_id", args.dealId)
    .order("version_number", { ascending: false });

  if (error) {
    throw new Error(`Failed to load deal override counter offers: ${error.message}`);
  }

  return (data ?? []) as DealOverrideCounterOfferRecord[];
}

export async function loadDealOverrideCounterOfferAudit(args: {
  organizationId: string;
  dealId: string;
}) {
  const offers = await listDealOverrideCounterOffers(args);
  const lookup = await getUserProfiles(offers.flatMap((offer) => [offer.reviewed_by ?? "", offer.accepted_by ?? ""]));

  return offers.map((offer) => ({
    ...offer,
    reviewerName:
      lookup.get(offer.reviewed_by ?? "")?.full_name ||
      lookup.get(offer.reviewed_by ?? "")?.email ||
      offer.reviewed_by ||
      null,
    acceptedByName:
      lookup.get(offer.accepted_by ?? "")?.full_name ||
      lookup.get(offer.accepted_by ?? "")?.email ||
      offer.accepted_by ||
      null,
  }));
}

async function supersedeOlderCounterOffers(args: {
  organizationId: string;
  dealId: string;
  requestId: string;
}) {
  const admin = createAdminClient();
  const timestamp = new Date().toISOString();
  const { error } = await admin
    .from("deal_override_counter_offers")
    .update({
      status: "superseded",
      updated_at: timestamp,
    })
    .eq("organization_id", args.organizationId)
    .eq("deal_id", args.dealId)
    .eq("deal_override_request_id", args.requestId)
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to supersede older counter offers: ${error.message}`);
  }
}

async function rejectCounterOfferAcceptance(args: {
  counterOfferId: string;
  organizationId: string;
  reason: string;
}) {
  const admin = createAdminClient();
  const timestamp = new Date().toISOString();
  const { error } = await admin
    .from("deal_override_counter_offers")
    .update({
      status: "rejected_acceptance",
      rejection_reason: args.reason,
      updated_at: timestamp,
    })
    .eq("id", args.counterOfferId)
    .eq("organization_id", args.organizationId)
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to reject counter offer acceptance: ${error.message}`);
  }
}

export async function persistStaleDealOverrideCounterOffers(args: {
  organizationId: string;
  dealId: string;
  currentInputFingerprint: string;
}) {
  const offers = await listDealOverrideCounterOffers({
    organizationId: args.organizationId,
    dealId: args.dealId,
  });
  const activeOffers = offers.filter((offer) => offer.status === "active");

  if (!activeOffers.length) {
    return [];
  }

  const admin = createAdminClient();
  const timestamp = new Date().toISOString();
  const staleOffers: DealOverrideCounterOfferRecord[] = [];

  for (const offer of activeOffers) {
    if (offer.base_structure_fingerprint === args.currentInputFingerprint) {
      continue;
    }

    const staleReason = "Deal structure inputs changed after the counter offer was created.";
    const { data, error } = await admin
      .from("deal_override_counter_offers")
      .update({
        status: "stale",
        stale_reason: staleReason,
        updated_at: timestamp,
      })
      .eq("id", offer.id)
      .eq("organization_id", args.organizationId)
      .eq("status", "active")
      .select("*")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to stale counter offer: ${error.message}`);
    }

    if (data) {
      staleOffers.push(data as DealOverrideCounterOfferRecord);
    }
  }

  return staleOffers;
}

export async function persistStaleDealOverrideTransitions(args: {
  organizationId: string;
  dealId: string;
  liveStructure: DealOverrideStructureSnapshot;
  customerName: string | null;
}) {
  const requests = await listDealOverrideRequests({
    organizationId: args.organizationId,
    dealId: args.dealId,
  });
  const currentFingerprint = buildDealOverrideFingerprint(args.liveStructure);
  const staleCandidates = requests.filter(
    (request) =>
      request.status === "approved" &&
      !!getStaleReasonForRequest({
        request: toRequestLike(request),
        currentFingerprint,
        liveVehicleId: args.liveStructure.vehicleId,
      })
  );

  if (!staleCandidates.length) {
    return [];
  }

  const admin = createAdminClient();
  const profileLookup = await getUserProfiles(
    staleCandidates.map((request) => request.requested_by ?? "")
  );

  const updatedRequests: DealOverrideRequestRecord[] = [];

  for (const request of staleCandidates) {
    const staleReason =
      getStaleReasonForRequest({
        request: toRequestLike(request),
        currentFingerprint,
        liveVehicleId: args.liveStructure.vehicleId,
      }) ?? "Deal structure changed after override approval.";

    const timestamp = new Date().toISOString();
    const { data, error } = await admin
      .from("deal_override_requests")
      .update({
        status: "stale",
        stale_reason: staleReason,
        status_changed_at: timestamp,
        updated_at: timestamp,
      })
      .eq("id", request.id)
      .eq("organization_id", args.organizationId)
      .eq("status", "approved")
      .select("*")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to mark override request stale: ${error.message}`);
    }

    if (!data) {
      continue;
    }

    const updatedRequest = data as DealOverrideRequestRecord;
    updatedRequests.push(updatedRequest);

    if (updatedRequest.requested_by) {
      await createAppNotifications({
        organizationId: args.organizationId,
        userIds: [updatedRequest.requested_by],
        type: "deal_override_stale",
        dealId: args.dealId,
        overrideRequestId: updatedRequest.id,
        title: `${updatedRequest.blocker_code} override is stale`,
        body: staleReason,
        linkHref: `/deals/${encodeURIComponent(args.dealId)}/deal`,
        metadata: {
          blockerCode: updatedRequest.blocker_code,
          staleReason,
        },
      });

      const requester = profileLookup.get(updatedRequest.requested_by);
      if (requester?.email) {
        await sendDealOverrideStaleEmail({
          organizationId: args.organizationId,
          dealId: args.dealId,
          blockerCode: updatedRequest.blocker_code,
          customerName: args.customerName,
          requesterEmail: requester.email,
          requesterName: requester.full_name,
          staleReason,
        }).catch((error) => {
          console.error("deal override stale email failed:", error);
        });
      }
    }
  }

  return updatedRequests;
}

export async function createDealOverrideRequest(args: {
  organizationId: string;
  dealId: string;
  blockerCode: DealOverrideBlockerCode;
  requestedByUserId: string;
  requestedNote: string | null;
  directApproval?: {
    reviewNote: string | null;
    reviewedByUserId: string;
  } | null;
  liveStructure: DealOverrideStructureSnapshot;
  failReasons: unknown;
  customerName: string | null;
  vehicleSummary: string;
}) {
  await persistStaleDealOverrideTransitions({
    organizationId: args.organizationId,
    dealId: args.dealId,
    liveStructure: args.liveStructure,
    customerName: args.customerName,
  });

  const requests = await listDealOverrideRequests({
    organizationId: args.organizationId,
    dealId: args.dealId,
  });
  const evaluation = evaluateDealOverrides({
    liveStructure: args.liveStructure,
    failReasons: args.failReasons,
    requests: requests.map(toRequestLike),
  });

  if (!evaluation.rawBlockers.includes(args.blockerCode)) {
    throw new Error("This blocker is not active for the current structure.");
  }

  const matchingPending = requests.find(
    (request) =>
      request.blocker_code === args.blockerCode &&
      request.status === "pending" &&
      request.structure_fingerprint === evaluation.currentFingerprint
  );

  if (matchingPending) {
    throw new Error("A pending override request already exists for this blocker.");
  }

  const matchingApproved = requests.find(
    (request) =>
      request.blocker_code === args.blockerCode &&
      request.status === "approved" &&
      request.structure_fingerprint === evaluation.currentFingerprint
  );

  if (matchingApproved) {
    throw new Error("A valid override already exists for this blocker.");
  }

  const timestamp = new Date().toISOString();
  const isDirectApproval = !!args.directApproval;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deal_override_requests")
    .insert({
      organization_id: args.organizationId,
      deal_id: args.dealId,
      blocker_code: args.blockerCode,
      status: isDirectApproval ? "approved" : "pending",
      requested_by: args.requestedByUserId,
      requested_note: args.requestedNote,
      requested_at: timestamp,
      reviewed_by: args.directApproval?.reviewedByUserId ?? null,
      review_note: args.directApproval?.reviewNote ?? null,
      reviewed_at: isDirectApproval ? timestamp : null,
      vehicle_id: args.liveStructure.vehicleId,
      cash_down_snapshot: args.liveStructure.cashDown,
      amount_financed_snapshot: args.liveStructure.amountFinanced,
      monthly_payment_snapshot: args.liveStructure.monthlyPayment,
      term_months_snapshot: args.liveStructure.termMonths,
      ltv_snapshot: args.liveStructure.ltv,
      pti_snapshot: args.liveStructure.pti,
      structure_fingerprint: evaluation.currentFingerprint,
      stale_reason: null,
      status_changed_at: timestamp,
      updated_at: timestamp,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create override request: ${error.message}`);
  }

  const request = data as DealOverrideRequestRecord;

  if (!isDirectApproval) {
    const notificationSettings = await getNotificationSettingsForOrganization(args.organizationId);
    const recipients = await loadOverrideAuthorityRecipients(args.organizationId);

    if (notificationSettings.overrideRequestAlerts) {
      await createAppNotifications({
        organizationId: args.organizationId,
        userIds: recipients.map((recipient) => recipient.userId),
        type: "deal_override_requested",
        dealId: args.dealId,
        overrideRequestId: request.id,
        title: `${args.blockerCode} override requested`,
        body: `${args.customerName?.trim() || "Deal"} needs ${args.blockerCode} review.`,
        linkHref: `/deals/${encodeURIComponent(args.dealId)}/deal`,
        metadata: {
          blockerCode: args.blockerCode,
          requestedBy: args.requestedByUserId,
        },
      });
    }

    await sendDealOverrideRequestedEmail({
      organizationId: args.organizationId,
      dealId: args.dealId,
      blockerCode: args.blockerCode,
      customerName: args.customerName,
      requestedByUserId: args.requestedByUserId,
      requestedNote: args.requestedNote,
      vehicleSummary: args.vehicleSummary,
      structure: {
        amountFinanced: args.liveStructure.amountFinanced,
        cashDown: args.liveStructure.cashDown,
        ltv: args.liveStructure.ltv,
        monthlyPayment: args.liveStructure.monthlyPayment,
        pti: args.liveStructure.pti,
        termMonths: args.liveStructure.termMonths,
      },
    }).catch((emailError) => {
      console.error("deal override request email failed:", emailError);
    });
  }

  return request;
}

export async function reviewDealOverrideRequest(args: {
  organizationId: string;
  dealId: string;
  requestId: string;
  reviewedByUserId: string;
  status: "approved" | "denied" | "countered";
  reviewNote: string | null;
  customerName: string | null;
  salespersonUserId: string | null;
  counterOffer?:
    | {
        counterType: DealOverrideCounterType;
        inputs: DealStructureInputsRecord;
        outputsSnapshot: Record<string, unknown>;
        baseStructureFingerprint: string;
        proposalStructureFingerprint: string;
      }
    | null;
}) {
  if ((args.status === "denied" || args.status === "countered") && !args.reviewNote?.trim()) {
    throw new Error("A review note is required for decline and counter-offer actions.");
  }

  if (args.status === "countered" && !args.counterOffer) {
    throw new Error("Counter offer payload is required.");
  }

  const timestamp = new Date().toISOString();
  const requestStatus = args.status === "countered" ? "pending" : args.status;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deal_override_requests")
    .update({
      status: requestStatus,
      reviewed_by: args.reviewedByUserId,
      review_note: args.reviewNote,
      reviewed_at: timestamp,
      status_changed_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", args.requestId)
    .eq("organization_id", args.organizationId)
    .eq("deal_id", args.dealId)
    .in("status", ["pending", "countered"])
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to review override request: ${error.message}`);
  }

  const request = data as DealOverrideRequestRecord;

  let counterOfferRecord: DealOverrideCounterOfferRecord | null = null;
  if (args.status === "countered" && args.counterOffer) {
    await supersedeOlderCounterOffers({
      organizationId: args.organizationId,
      dealId: args.dealId,
      requestId: args.requestId,
    });

    const existingOffers = await listDealOverrideCounterOffers({
      organizationId: args.organizationId,
      dealId: args.dealId,
    });
    const nextVersion =
      existingOffers
        .filter((offer) => offer.deal_override_request_id === args.requestId)
        .reduce((max, offer) => Math.max(max, offer.version_number), 0) + 1;

    const insertPayload = {
      deal_override_request_id: args.requestId,
      organization_id: args.organizationId,
      deal_id: args.dealId,
      version_number: nextVersion,
      counter_type: args.counterOffer.counterType,
      review_note: args.reviewNote ?? "",
      reviewed_by: args.reviewedByUserId,
      reviewed_at: timestamp,
      base_structure_fingerprint: args.counterOffer.baseStructureFingerprint,
      proposal_structure_fingerprint: args.counterOffer.proposalStructureFingerprint,
      inputs_json: args.counterOffer.inputs as unknown as Json,
      outputs_snapshot_json: args.counterOffer.outputsSnapshot as unknown as Json,
      status: "active",
      stale_reason: null,
      rejection_reason: null,
      accepted_at: null,
      accepted_by: null,
      updated_at: timestamp,
    } satisfies Database["public"]["Tables"]["deal_override_counter_offers"]["Insert"];

    const { data: insertedCounter, error: counterErr } = await admin
      .from("deal_override_counter_offers")
      .insert(insertPayload)
      .select("*")
      .single();

    if (counterErr) {
      throw new Error(`Failed to create counter offer: ${counterErr.message}`);
    }

    counterOfferRecord = insertedCounter as DealOverrideCounterOfferRecord;

    await sendDealOverrideCounterOfferEmail({
      organizationId: args.organizationId,
      dealId: args.dealId,
      blockerCode: request.blocker_code,
      customerName: args.customerName,
      reviewNote: args.reviewNote,
      reviewedByUserId: args.reviewedByUserId,
      salespersonUserId: args.salespersonUserId,
      structure: getCounterOfferEmailStructure(args.counterOffer.outputsSnapshot),
    }).catch((emailError) => {
      console.error("deal override counter offer email failed:", emailError);
    });
  }

  const profileLookup = await getUserProfiles([
    request.requested_by ?? "",
    args.reviewedByUserId,
  ]);

  if (request.requested_by) {
    await createAppNotifications({
      organizationId: args.organizationId,
      userIds: [request.requested_by],
      type:
        args.status === "approved"
          ? "deal_override_approved"
          : args.status === "countered"
            ? "deal_override_requested"
            : "deal_override_denied",
      dealId: args.dealId,
      overrideRequestId: request.id,
      title: `${request.blocker_code} override ${args.status}`,
      body:
        args.status === "approved"
          ? `${request.blocker_code} override was approved.`
          : args.status === "countered"
            ? `${request.blocker_code} override received a counter offer.`
          : `${request.blocker_code} override was denied.`,
      linkHref: `/deals/${encodeURIComponent(args.dealId)}/deal`,
      metadata: {
        blockerCode: request.blocker_code,
        reviewNote: args.reviewNote,
        counterOfferId: counterOfferRecord?.id ?? null,
      },
    });

    const requester = profileLookup.get(request.requested_by);
    if (requester?.email) {
      const emailArgs = {
        organizationId: args.organizationId,
        dealId: args.dealId,
        blockerCode: request.blocker_code,
        customerName: args.customerName,
        requesterEmail: requester.email,
        requesterName: requester.full_name,
        reviewNote: args.reviewNote,
        reviewedByUserId: args.reviewedByUserId,
      };

      if (args.status === "approved") {
        await sendDealOverrideApprovedEmail(emailArgs).catch((emailError) => {
          console.error("deal override approved email failed:", emailError);
        });
      } else if (args.status === "denied") {
        await sendDealOverrideDeniedEmail(emailArgs).catch((emailError) => {
          console.error("deal override denied email failed:", emailError);
        });
      }
    }
  }

  return { request, counterOffer: counterOfferRecord };
}

export async function loadDealOverrideSnapshot(args: {
  organizationId: string;
  dealId: string;
  liveStructure: DealOverrideStructureSnapshot;
  currentInputFingerprint?: string | null;
  failReasons: unknown;
  customerName: string | null;
}) {
  await persistStaleDealOverrideTransitions({
    organizationId: args.organizationId,
    dealId: args.dealId,
    liveStructure: args.liveStructure,
    customerName: args.customerName,
  });
  if (args.currentInputFingerprint) {
    await persistStaleDealOverrideCounterOffers({
      organizationId: args.organizationId,
      dealId: args.dealId,
      currentInputFingerprint: args.currentInputFingerprint,
    });
  }

  const requests = await loadDealOverrideAudit({
    organizationId: args.organizationId,
    dealId: args.dealId,
  });
  const counterOffers = await loadDealOverrideCounterOfferAudit({
    organizationId: args.organizationId,
    dealId: args.dealId,
  });

  const evaluation = evaluateDealOverrides({
    liveStructure: args.liveStructure,
    failReasons: args.failReasons,
    requests: requests.map((request) => ({
      blockerCode: request.blocker_code,
      status: request.status,
      structureFingerprint: request.structure_fingerprint,
      vehicleId: request.vehicle_id,
      staleReason: request.stale_reason,
      requestedAt: request.requested_at,
    })),
  });

  return {
    currentFingerprint: buildDealOverrideFingerprint(args.liveStructure),
    blockerStates: evaluation.blockerStates,
    effectiveBlockers: evaluation.effectiveBlockers,
    rawBlockers: evaluation.rawBlockers,
    requests,
    counterOffers,
    latestCounterOffer:
      counterOffers.find((offer) => offer.status === "active") ??
      counterOffers[0] ??
      null,
  };
}

export async function acceptLatestDealOverrideCounterOffer(args: {
  organizationId: string;
  dealId: string;
  requestId: string;
  acceptedByUserId: string;
  currentInputFingerprint: string;
}) {
  const offers = await listDealOverrideCounterOffers({
    organizationId: args.organizationId,
    dealId: args.dealId,
  });
  const latestOffer =
    offers.find((offer) => offer.deal_override_request_id === args.requestId) ?? null;

  if (!latestOffer) {
    throw new Error("No counter offer exists for this override request.");
  }

  if (latestOffer.status !== "active") {
    throw new Error("This counter offer is no longer actionable.");
  }

  if (latestOffer.base_structure_fingerprint !== args.currentInputFingerprint) {
    const reason = "Counter offer is stale because the live structure changed.";
    await rejectCounterOfferAcceptance({
      counterOfferId: latestOffer.id,
      organizationId: args.organizationId,
      reason,
    });
    throw new Error(reason);
  }

  const admin = createAdminClient();
  const timestamp = new Date().toISOString();
  const { data, error } = await admin
    .from("deal_override_counter_offers")
    .update({
      status: "accepted_counter",
      accepted_at: timestamp,
      accepted_by: args.acceptedByUserId,
      updated_at: timestamp,
    })
    .eq("id", latestOffer.id)
    .eq("organization_id", args.organizationId)
    .eq("status", "active")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to accept counter offer: ${error.message}`);
  }

  if (!data) {
    throw new Error("This counter offer was already handled or is no longer active.");
  }

  const acceptedOffer = data as DealOverrideCounterOfferRecord;
  const acceptedSnapshot = getCounterOfferOverrideSnapshot(
    acceptedOffer.outputs_snapshot_json
  );
  const { error: requestErr } = await admin
    .from("deal_override_requests")
    .update({
      status: "approved",
      structure_fingerprint: buildDealOverrideFingerprint(acceptedSnapshot),
      vehicle_id: acceptedSnapshot.vehicleId,
      cash_down_snapshot: acceptedSnapshot.cashDown,
      amount_financed_snapshot: acceptedSnapshot.amountFinanced,
      monthly_payment_snapshot: acceptedSnapshot.monthlyPayment,
      term_months_snapshot: acceptedSnapshot.termMonths,
      ltv_snapshot: acceptedSnapshot.ltv,
      pti_snapshot: acceptedSnapshot.pti,
      stale_reason: null,
      status_changed_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", args.requestId)
    .eq("organization_id", args.organizationId)
    .eq("deal_id", args.dealId);

  if (requestErr) {
    throw new Error(`Failed to approve accepted counter offer: ${requestErr.message}`);
  }

  return acceptedOffer;
}
