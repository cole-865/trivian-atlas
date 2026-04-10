import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";
import { sendEmail, type EmailSendResult } from "@/lib/email/mailer";

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
  can_approve_deal_overrides?: boolean;
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

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_users")
    .select("user_id, is_active, can_approve_deal_overrides")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("can_approve_deal_overrides", true);

  if (error) {
    throw new Error(`Failed to load override authority recipients: ${error.message}`);
  }

  const memberships = (data ?? []) as MembershipRow[];
  const profileLookup = await getUserProfilesByIds(memberships.map((row) => row.user_id));

  return memberships
    .map((membership) => {
      const profile = profileLookup.get(membership.user_id);
      const email = profile?.email?.trim() ?? "";
      const isActive = profile?.is_active ?? true;

      if (!membership.can_approve_deal_overrides || !email || !isActive) {
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
    subject: `${customerName} is ready for final approval`,
    text: [
      `${customerName} was submitted for final approval in the ${organization.name} account.`,
      "",
      `Submitted by: ${submittedBy}`,
      `Review deal: ${reviewUrl}`,
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
        <p><strong>${safeCustomerName}</strong> was submitted for final approval in the <strong>${safeAccountName}</strong> account.</p>
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
