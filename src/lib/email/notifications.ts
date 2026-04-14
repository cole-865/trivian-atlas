import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";
import { sendEmail, type EmailSendResult } from "@/lib/email/mailer";
import { listActiveOrganizationUsersWithPermission } from "@/lib/auth/dealershipPermissions";

type UserProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active?: boolean;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
};

type MembershipRow = {
  user_id: string;
  role: string;
  is_active: boolean;
};

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getOrganizationById(organizationId: string): Promise<OrganizationRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("id, name, slug")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load account details: ${error.message}`);
  }

  return (data as OrganizationRow | null) ?? null;
}

async function getUserProfilesByIds(userIds: string[]) {
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
    throw new Error(`Failed to load user email profiles: ${error.message}`);
  }

  for (const row of (data ?? []) as UserProfileRow[]) {
    lookup.set(row.id, row);
  }

  return lookup;
}

async function getOrganizationRoleRecipients(organizationId: string, roles: string[]) {
  if (!hasAdminAccess()) {
    return [] as Array<{ email: string; fullName: string | null; userId: string }>;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_users")
    .select("user_id, role, is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .in("role", roles);

  if (error) {
    throw new Error(`Failed to load account recipients: ${error.message}`);
  }

  const memberships = (data ?? []) as MembershipRow[];
  const profileLookup = await getUserProfilesByIds(memberships.map((row) => row.user_id));

  return memberships
    .map((membership) => {
      const profile = profileLookup.get(membership.user_id);
      const email = profile?.email?.trim() ?? "";
      const isActive = profile?.is_active ?? true;

      if (!email || !isActive) {
        return null;
      }

      return {
        userId: membership.user_id,
        email,
        fullName: profile?.full_name ?? null,
      };
    })
    .filter(
      (
        recipient
      ): recipient is { email: string; fullName: string | null; userId: string } => !!recipient
    );
}

async function getOverrideAuthorityRecipients(organizationId: string) {
  if (!hasAdminAccess()) {
    return [] as Array<{ email: string; fullName: string | null; userId: string }>;
  }

  const userIds = await listActiveOrganizationUsersWithPermission(
    organizationId,
    "approve_overrides"
  );
  const profileLookup = await getUserProfilesByIds(userIds);

  return userIds
    .map((userId) => {
      const profile = profileLookup.get(userId);
      const email = profile?.email?.trim() ?? "";
      const isActive = profile?.is_active ?? true;

      if (!email || !isActive) {
        return null;
      }

      return {
        userId,
        email,
        fullName: profile?.full_name ?? null,
      };
    })
    .filter(
      (
        recipient
      ): recipient is { email: string; fullName: string | null; userId: string } => !!recipient
    );
}

async function getUserDisplayName(userId: string | null | undefined) {
  if (!userId || !hasAdminAccess()) {
    return "A Trivian Atlas user";
  }

  const profileLookup = await getUserProfilesByIds([userId]);
  const profile = profileLookup.get(userId);
  return profile?.full_name || profile?.email || "A Trivian Atlas user";
}

export async function sendOrganizationInviteEmail(args: {
  organizationId: string;
  inviteeEmail: string;
  inviteeFullName: string | null;
  invitedByUserId: string | null;
  role: string;
  acceptUrl: string;
}): Promise<EmailSendResult> {
  if (!hasAdminAccess()) {
    return {
      sent: false,
      reason: "Email delivery requires SUPABASE_SERVICE_ROLE_KEY for invite lookups.",
    };
  }

  const organization = await getOrganizationById(args.organizationId);
  if (!organization) {
    return {
      sent: false,
      reason: "Account was not found while preparing the invitation email.",
    };
  }

  const inviterName = await getUserDisplayName(args.invitedByUserId);
  const inviteeName = args.inviteeFullName?.trim() || "there";
  const accountName = organization.name;
  const safeAccountName = escapeHtml(accountName);
  const safeInviteeName = escapeHtml(inviteeName);
  const safeInviterName = escapeHtml(inviterName);
  const safeRole = escapeHtml(args.role);
  const safeAcceptUrl = escapeHtml(args.acceptUrl);

  return sendEmail({
    to: [args.inviteeEmail],
    subject: `You're invited to join ${accountName} in Trivian Atlas`,
    text: [
      `Hi ${inviteeName},`,
      "",
      `${inviterName} invited you to join the ${accountName} account in Trivian Atlas as ${args.role}.`,
      "",
      `Accept your invite: ${args.acceptUrl}`,
      "",
      "This link expires in 7 days.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
        <p>Hi ${safeInviteeName},</p>
        <p>${safeInviterName} invited you to join the <strong>${safeAccountName}</strong> account in Trivian Atlas as <strong>${safeRole}</strong>.</p>
        <p><a href="${safeAcceptUrl}">Accept your invite</a></p>
        <p>This link expires in 7 days.</p>
      </div>
    `,
  });
}

export async function sendDealApprovalRequestEmail(args: {
  organizationId: string;
  dealId: string;
  customerName: string | null;
  submittedByUserId: string | null;
}) {
  if (!hasAdminAccess()) {
    return {
      sent: false,
      reason: "Email delivery requires SUPABASE_SERVICE_ROLE_KEY for recipient lookups.",
    } satisfies EmailSendResult;
  }

  const organization = await getOrganizationById(args.organizationId);
  if (!organization) {
    return {
      sent: false,
      reason: "Account was not found while preparing the approval email.",
    } satisfies EmailSendResult;
  }

  const recipients = await getOrganizationRoleRecipients(args.organizationId, [
    "management",
    "admin",
  ]);
  const to = Array.from(new Set(recipients.map((recipient) => recipient.email)));

  if (!to.length) {
    return {
      sent: false,
      reason: "No active management or admin recipients are configured for this account.",
    } satisfies EmailSendResult;
  }

  const submittedBy = await getUserDisplayName(args.submittedByUserId);
  const customerName = args.customerName?.trim() || "Untitled customer";
  const reviewUrl = `${getSiteUrl()}/deals/${encodeURIComponent(args.dealId)}/fund`;
  const safeAccountName = escapeHtml(organization.name);
  const safeCustomerName = escapeHtml(customerName);
  const safeSubmittedBy = escapeHtml(submittedBy);
  const safeReviewUrl = escapeHtml(reviewUrl);

  return sendEmail({
    to,
    subject: `${customerName} is ready for funding review`,
    text: [
      `${customerName} is ready for funding review in the ${organization.name} account.`,
      "",
      `Submitted by: ${submittedBy}`,
      `Review deal: ${reviewUrl}`,
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
        <p><strong>${safeCustomerName}</strong> is ready for funding review in the <strong>${safeAccountName}</strong> account.</p>
        <p>Submitted by: ${safeSubmittedBy}</p>
        <p><a href="${safeReviewUrl}">Review deal in Trivian Atlas</a></p>
      </div>
    `,
  });
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }

  return Number(value).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${(Number(value) * 100).toFixed(2)}%`;
}

type OverrideEmailStructure = {
  amountFinanced: number | null;
  cashDown: number | null;
  ltv: number | null;
  monthlyPayment: number | null;
  pti: number | null;
  termMonths: number | null;
};

function buildOverrideStructureLines(structure: OverrideEmailStructure) {
  return [
    `Term: ${structure.termMonths != null ? `${structure.termMonths} month term` : "n/a"}`,
    `Cash down: ${money(structure.cashDown)}`,
    `Amount financed: ${money(structure.amountFinanced)}`,
    `Monthly payment: ${money(structure.monthlyPayment)}`,
    `LTV: ${percent(structure.ltv)}`,
    `PTI: ${percent(structure.pti)}`,
  ];
}

function toEmailRecipient(profile: UserProfileRow | undefined, userId: string) {
  const email = profile?.email?.trim() ?? "";
  const isActive = profile?.is_active ?? true;

  if (!email || !isActive) {
    return null;
  }

  return {
    userId,
    email,
    fullName: profile?.full_name ?? null,
  };
}

async function getCounterOfferRecipients(args: {
  organizationId: string;
  salespersonUserId: string | null;
}) {
  const managementRecipients = await getOrganizationRoleRecipients(args.organizationId, [
    "management",
    "admin",
  ]);
  const recipients = [...managementRecipients];
  const salespersonUserId = args.salespersonUserId?.trim() || null;

  if (salespersonUserId) {
    const salespersonLookup = await getUserProfilesByIds([salespersonUserId]);
    const salesperson = toEmailRecipient(
      salespersonLookup.get(salespersonUserId),
      salespersonUserId
    );

    if (salesperson) {
      recipients.push(salesperson);
    }
  }

  return Array.from(
    new Map(recipients.map((recipient) => [recipient.email, recipient])).values()
  );
}

async function getFundingOutcomeRecipients(args: {
  organizationId: string;
  salespersonUserId: string | null;
  submittedByUserId: string | null;
}) {
  const managementRecipients = await getOrganizationRoleRecipients(args.organizationId, [
    "management",
    "admin",
  ]);
  const involvedUserIds = [args.salespersonUserId, args.submittedByUserId].filter(
    (userId): userId is string => !!userId
  );
  const involvedLookup = await getUserProfilesByIds(involvedUserIds);
  const involvedRecipients = involvedUserIds
    .map((userId) => toEmailRecipient(involvedLookup.get(userId), userId))
    .filter(
      (
        recipient
      ): recipient is { email: string; fullName: string | null; userId: string } => !!recipient
    );

  return Array.from(
    new Map(
      [...managementRecipients, ...involvedRecipients].map((recipient) => [
        recipient.email,
        recipient,
      ])
    ).values()
  );
}

export async function sendDealFundingOutcomeEmail(args: {
  organizationId: string;
  dealId: string;
  dealNumber: string | null;
  customerName: string | null;
  salespersonUserId: string | null;
  submittedByUserId: string | null;
  outcome: "funded" | "funded_with_changes" | "rejected" | "restructure_requested";
  reason?: string | null;
  verifiedMonthlyIncome?: number | null;
}) {
  if (!hasAdminAccess()) {
    return {
      sent: false,
      reason: "Email delivery requires SUPABASE_SERVICE_ROLE_KEY for recipient lookups.",
    } satisfies EmailSendResult;
  }

  const organization = await getOrganizationById(args.organizationId);
  if (!organization) {
    return {
      sent: false,
      reason: "Account was not found while preparing the funding email.",
    } satisfies EmailSendResult;
  }

  const recipients = await getFundingOutcomeRecipients({
    organizationId: args.organizationId,
    salespersonUserId: args.salespersonUserId,
    submittedByUserId: args.submittedByUserId,
  });
  const to = recipients.map((recipient) => recipient.email);

  if (!to.length) {
    return {
      sent: false,
      reason: "No active funding outcome recipients are configured for this account.",
    } satisfies EmailSendResult;
  }

  const dealLabel = args.dealNumber?.trim() || args.dealId;
  const customerName = args.customerName?.trim() || `Deal #${dealLabel}`;
  const reviewUrl = `${getSiteUrl()}/deals/${encodeURIComponent(args.dealId)}/fund`;
  const reason = args.reason?.trim() || "No reason provided.";
  const verifiedIncomeLine =
    args.verifiedMonthlyIncome != null && Number.isFinite(args.verifiedMonthlyIncome)
      ? `Verified monthly income: ${money(args.verifiedMonthlyIncome)}`
      : null;
  const outcomeText =
    args.outcome === "funded"
      ? "is funded. No further review!"
      : args.outcome === "funded_with_changes"
        ? "is funded with verified income changes."
        : args.outcome === "restructure_requested"
          ? "was sent back to underwriting to restructure."
          : `funding was rejected: ${reason}`;

  return sendEmail({
    to,
    subject: `Deal #${dealLabel} ${args.outcome === "rejected" ? "funding rejected" : args.outcome === "restructure_requested" ? "sent back to underwriting" : "funded"}`,
    text: [
      `Deal #${dealLabel} for ${customerName} ${outcomeText}`,
      `Account: ${organization.name}`,
      verifiedIncomeLine,
      args.outcome === "funded" ? null : `Reason: ${reason}`,
      `Review deal: ${reviewUrl}`,
    ]
      .filter((line): line is string => !!line)
      .join("\n"),
  });
}

export async function sendDealOverrideRequestedEmail(args: {
  organizationId: string;
  dealId: string;
  blockerCode: string;
  customerName: string | null;
  requestedByUserId: string | null;
  requestedNote: string | null;
  vehicleSummary: string;
  structure: OverrideEmailStructure;
}) {
  if (!hasAdminAccess()) {
    return {
      sent: false,
      reason: "Email delivery requires SUPABASE_SERVICE_ROLE_KEY for recipient lookups.",
    } satisfies EmailSendResult;
  }

  const organization = await getOrganizationById(args.organizationId);
  if (!organization) {
    return {
      sent: false,
      reason: "Account was not found while preparing the override request email.",
    } satisfies EmailSendResult;
  }

  const recipients = await getOverrideAuthorityRecipients(args.organizationId);
  const to = Array.from(new Set(recipients.map((recipient) => recipient.email)));

  if (!to.length) {
    return {
      sent: false,
      reason: "No active override approvers are configured for this account.",
    } satisfies EmailSendResult;
  }

  const requester = await getUserDisplayName(args.requestedByUserId);
  const customerName = args.customerName?.trim() || "Untitled customer";
  const reviewUrl = `${getSiteUrl()}/deals/${encodeURIComponent(args.dealId)}/deal`;
  const safeReviewUrl = escapeHtml(reviewUrl);
  const safeCustomerName = escapeHtml(customerName);
  const safeBlockerCode = escapeHtml(args.blockerCode);
  const safeRequester = escapeHtml(requester);
  const safeVehicleSummary = escapeHtml(args.vehicleSummary);
  const requestedNote = args.requestedNote?.trim() || "No note provided.";
  const safeRequestedNote = escapeHtml(requestedNote);

  return sendEmail({
    to,
    subject: `${customerName} requested a ${args.blockerCode} override`,
    text: [
      `${customerName} requested a ${args.blockerCode} override in ${organization.name}.`,
      "",
      `Requested by: ${requester}`,
      `Vehicle: ${args.vehicleSummary}`,
      ...buildOverrideStructureLines(args.structure),
      "",
      "Override request:",
      requestedNote,
      `Review in Atlas: ${reviewUrl}`,
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
        <p><strong>${safeCustomerName}</strong> requested a <strong>${safeBlockerCode}</strong> override in <strong>${escapeHtml(organization.name)}</strong>.</p>
        <p>Requested by: ${safeRequester}</p>
        <p>Vehicle: ${safeVehicleSummary}</p>
        <p>Override request:</p>
        <pre style="white-space: pre-wrap; font-family: Arial, sans-serif; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">${safeRequestedNote}</pre>
        <p><a href="${safeReviewUrl}">Review override in Trivian Atlas</a></p>
      </div>
    `,
  });
}

export async function sendDealOverrideCounterOfferEmail(args: {
  organizationId: string;
  dealId: string;
  blockerCode: string;
  customerName: string | null;
  reviewNote: string | null;
  reviewedByUserId: string | null;
  salespersonUserId: string | null;
  structure: OverrideEmailStructure;
}) {
  if (!hasAdminAccess()) {
    return {
      sent: false,
      reason: "Email delivery requires SUPABASE_SERVICE_ROLE_KEY for recipient lookups.",
    } satisfies EmailSendResult;
  }

  const organization = await getOrganizationById(args.organizationId);
  if (!organization) {
    return {
      sent: false,
      reason: "Account was not found while preparing the counter offer email.",
    } satisfies EmailSendResult;
  }

  const recipients = await getCounterOfferRecipients({
    organizationId: args.organizationId,
    salespersonUserId: args.salespersonUserId,
  });
  const to = recipients.map((recipient) => recipient.email);

  if (!to.length) {
    return {
      sent: false,
      reason: "No active salesperson, management, or admin recipients are configured for this account.",
    } satisfies EmailSendResult;
  }

  const customerName = args.customerName?.trim() || "Untitled customer";
  const reviewedBy = await getUserDisplayName(args.reviewedByUserId);
  const reviewUrl = `${getSiteUrl()}/deals/${encodeURIComponent(args.dealId)}/deal`;
  const reviewNote = args.reviewNote?.trim() || "No note provided.";
  const safeCustomerName = escapeHtml(customerName);
  const safeBlockerCode = escapeHtml(args.blockerCode);
  const safeOrganizationName = escapeHtml(organization.name);
  const safeReviewedBy = escapeHtml(reviewedBy);
  const safeReviewUrl = escapeHtml(reviewUrl);
  const safeReviewNote = escapeHtml(reviewNote);

  return sendEmail({
    to,
    subject: `${customerName} received a ${args.blockerCode} counter offer`,
    text: [
      `${customerName} received a ${args.blockerCode} counter offer in ${organization.name}.`,
      "",
      `Countered by: ${reviewedBy}`,
      ...buildOverrideStructureLines(args.structure),
      "",
      "Counter note:",
      reviewNote,
      `Review in Atlas: ${reviewUrl}`,
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
        <p><strong>${safeCustomerName}</strong> received a <strong>${safeBlockerCode}</strong> counter offer in <strong>${safeOrganizationName}</strong>.</p>
        <p>Countered by: ${safeReviewedBy}</p>
        <p>Counter note:</p>
        <pre style="white-space: pre-wrap; font-family: Arial, sans-serif; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">${safeReviewNote}</pre>
        <p><a href="${safeReviewUrl}">Review counter offer in Trivian Atlas</a></p>
      </div>
    `,
  });
}

type OverrideOutcomeEmailArgs = {
  organizationId: string;
  dealId: string;
  blockerCode: string;
  customerName: string | null;
  requesterEmail: string;
  requesterName: string | null;
  reviewNote?: string | null;
  reviewedByUserId?: string | null;
  staleReason?: string | null;
};

async function sendDealOverrideOutcomeEmail(
  args: OverrideOutcomeEmailArgs & {
    outcomeLabel: string;
    reasonLabel: string;
  }
) {
  if (!hasAdminAccess()) {
    return {
      sent: false,
      reason: "Email delivery requires SUPABASE_SERVICE_ROLE_KEY for recipient lookups.",
    } satisfies EmailSendResult;
  }

  const organization = await getOrganizationById(args.organizationId);
  if (!organization) {
    return {
      sent: false,
      reason: "Account was not found while preparing the override outcome email.",
    } satisfies EmailSendResult;
  }

  const customerName = args.customerName?.trim() || "Untitled customer";
  const requesterName = args.requesterName?.trim() || "there";
  const reviewedBy = await getUserDisplayName(args.reviewedByUserId);
  const reviewUrl = `${getSiteUrl()}/deals/${encodeURIComponent(args.dealId)}/deal`;
  const detail =
    args.staleReason?.trim() ||
    args.reviewNote?.trim() ||
    "No additional notes were provided.";

  return sendEmail({
    to: [args.requesterEmail],
    subject: `${customerName} ${args.blockerCode} override ${args.outcomeLabel}`,
    text: [
      `Hi ${requesterName},`,
      "",
      `${customerName}'s ${args.blockerCode} override is now ${args.outcomeLabel}.`,
      `Handled by: ${reviewedBy}`,
      `${args.reasonLabel}: ${detail}`,
      `Review deal: ${reviewUrl}`,
    ].join("\n"),
  });
}

export async function sendDealOverrideApprovedEmail(args: OverrideOutcomeEmailArgs) {
  return sendDealOverrideOutcomeEmail({
    ...args,
    outcomeLabel: "approved",
    reasonLabel: "Review note",
  });
}

export async function sendDealOverrideDeniedEmail(args: OverrideOutcomeEmailArgs) {
  return sendDealOverrideOutcomeEmail({
    ...args,
    outcomeLabel: "denied",
    reasonLabel: "Review note",
  });
}

export async function sendDealOverrideStaleEmail(args: {
  organizationId: string;
  dealId: string;
  blockerCode: string;
  customerName: string | null;
  requesterEmail: string;
  requesterName: string | null;
  staleReason: string;
}) {
  return sendDealOverrideOutcomeEmail({
    ...args,
    outcomeLabel: "is stale",
    reasonLabel: "Stale reason",
    reviewNote: null,
    reviewedByUserId: null,
  });
}
