import { createAdminClient } from "@/lib/supabase/admin";
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
  sendDealOverrideDeniedEmail,
  sendDealOverrideRequestedEmail,
  sendDealOverrideStaleEmail,
} from "@/lib/email/notifications";

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

type UserProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
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

export async function loadOverrideAuthorityRecipients(organizationId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_users")
    .select("user_id, can_approve_deal_overrides, is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("can_approve_deal_overrides", true);

  if (error) {
    throw new Error(`Failed to load override authority recipients: ${error.message}`);
  }

  const userIds = (data ?? []).map((row) => String(row.user_id));
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
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deal_override_requests")
    .insert({
      organization_id: args.organizationId,
      deal_id: args.dealId,
      blocker_code: args.blockerCode,
      status: "pending",
      requested_by: args.requestedByUserId,
      requested_note: args.requestedNote,
      requested_at: timestamp,
      reviewed_by: null,
      review_note: null,
      reviewed_at: null,
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
  const recipients = await loadOverrideAuthorityRecipients(args.organizationId);

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

  return request;
}

export async function reviewDealOverrideRequest(args: {
  organizationId: string;
  dealId: string;
  requestId: string;
  reviewedByUserId: string;
  status: "approved" | "denied";
  reviewNote: string | null;
  customerName: string | null;
}) {
  const timestamp = new Date().toISOString();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deal_override_requests")
    .update({
      status: args.status,
      reviewed_by: args.reviewedByUserId,
      review_note: args.reviewNote,
      reviewed_at: timestamp,
      status_changed_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", args.requestId)
    .eq("organization_id", args.organizationId)
    .eq("deal_id", args.dealId)
    .eq("status", "pending")
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to review override request: ${error.message}`);
  }

  const request = data as DealOverrideRequestRecord;
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
          : "deal_override_denied",
      dealId: args.dealId,
      overrideRequestId: request.id,
      title: `${request.blocker_code} override ${args.status}`,
      body:
        args.status === "approved"
          ? `${request.blocker_code} override was approved.`
          : `${request.blocker_code} override was denied.`,
      linkHref: `/deals/${encodeURIComponent(args.dealId)}/deal`,
      metadata: {
        blockerCode: request.blocker_code,
        reviewNote: args.reviewNote,
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
      } else {
        await sendDealOverrideDeniedEmail(emailArgs).catch((emailError) => {
          console.error("deal override denied email failed:", emailError);
        });
      }
    }
  }

  return request;
}

export async function loadDealOverrideSnapshot(args: {
  organizationId: string;
  dealId: string;
  liveStructure: DealOverrideStructureSnapshot;
  failReasons: unknown;
  customerName: string | null;
}) {
  await persistStaleDealOverrideTransitions({
    organizationId: args.organizationId,
    dealId: args.dealId,
    liveStructure: args.liveStructure,
    customerName: args.customerName,
  });

  const requests = await loadDealOverrideAudit({
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
  };
}
