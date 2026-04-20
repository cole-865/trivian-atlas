export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";
export type SwitchOrganizationDecision = "clear" | "set" | "reject";

export const ORG_MANAGED_ROLES = ["sales", "management", "admin"] as const;
export const APP_USER_ROLES = [...ORG_MANAGED_ROLES, "dev"] as const;

export type OrganizationScopedRole = (typeof ORG_MANAGED_ROLES)[number];
export type AppUserRole = (typeof APP_USER_ROLES)[number];

export function isOrganizationScopedRole(
  value: unknown
): value is OrganizationScopedRole {
  return (
    typeof value === "string" &&
    ORG_MANAGED_ROLES.includes(value as OrganizationScopedRole)
  );
}

export function isAppUserRole(value: unknown): value is AppUserRole {
  return typeof value === "string" && APP_USER_ROLES.includes(value as AppUserRole);
}

export function isPlatformDevRole(role: AppUserRole | null | undefined) {
  return role === "dev";
}

export function isOrganizationAdminRole(
  role: OrganizationScopedRole | AppUserRole | null | undefined
) {
  return role === "admin";
}

export function canCreateOrganizationsForRole(role: AppUserRole | null | undefined) {
  return isPlatformDevRole(role);
}

export function canManageCurrentOrganizationForRole(args: {
  currentOrganizationId: string | null;
  isImpersonating?: boolean;
  realRole: AppUserRole | null | undefined;
  effectiveOrganizationRole: AppUserRole | null | undefined;
}) {
  return !!args.currentOrganizationId && (
    (!args.isImpersonating && isPlatformDevRole(args.realRole)) ||
    isOrganizationAdminRole(args.effectiveOrganizationRole)
  );
}

export function getInviteAcceptanceBlockReason(args: {
  status: InvitationStatus;
  isExpired: boolean;
  inviteEmail: string;
  authenticatedEmail: string | null | undefined;
}) {
  if (args.status === "revoked") {
    return "This invitation has been revoked.";
  }

  if (args.status === "accepted") {
    return "This invitation has already been accepted.";
  }

  if (args.isExpired) {
    return "This invitation has expired.";
  }

  const authenticatedEmail = args.authenticatedEmail?.trim().toLowerCase() ?? "";
  const inviteEmail = args.inviteEmail.trim().toLowerCase();

  if (!authenticatedEmail || authenticatedEmail !== inviteEmail) {
    return "You must sign in with the invited email address to accept this invitation.";
  }

  return null;
}

export function getImpersonationDecision(args: {
  realRole: AppUserRole | null | undefined;
  realUserId: string | null | undefined;
  currentOrganizationId: string | null | undefined;
  targetUserId: string | null | undefined;
  targetUserActive: boolean;
  targetMembershipOrganizationId: string | null | undefined;
}) {
  if (
    !isPlatformDevRole(args.realRole) ||
    !args.realUserId ||
    !args.currentOrganizationId ||
    !args.targetUserId
  ) {
    return "reject" as const;
  }

  if (args.targetUserId === args.realUserId) {
    return "clear" as const;
  }

  if (!args.targetUserActive) {
    return "reject" as const;
  }

  if (args.targetMembershipOrganizationId !== args.currentOrganizationId) {
    return "reject" as const;
  }

  return "impersonate" as const;
}

export function getOrganizationSwitchDecision(args: {
  requestedOrganizationId: string | null | undefined;
  switchableOrganizationIds: string[];
}) {
  const requestedOrganizationId = args.requestedOrganizationId?.trim() ?? "";

  if (!requestedOrganizationId) {
    return "clear" as SwitchOrganizationDecision;
  }

  if (!args.switchableOrganizationIds.includes(requestedOrganizationId)) {
    return "reject" as SwitchOrganizationDecision;
  }

  return "set" as SwitchOrganizationDecision;
}
