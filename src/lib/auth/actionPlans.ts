import {
  getImpersonationDecision,
  getOrganizationSwitchDecision,
  type AppUserRole,
} from "./accessRules";

const ORG_REVALIDATE_PATHS = ["/", "/settings", "/dev-tools"] as const;
const IMPERSONATION_REVALIDATE_PATHS = ["/", "/settings"] as const;

export function planOrganizationSwitch(args: {
  requestedOrganizationId: string | null | undefined;
  switchableOrganizationIds: string[];
}) {
  const decision = getOrganizationSwitchDecision(args);

  if (decision === "clear") {
    return {
      cookieAction: "clear" as const,
      organizationId: null,
      revalidatePaths: ORG_REVALIDATE_PATHS,
    };
  }

  if (decision === "reject") {
    return {
      cookieAction: "noop" as const,
      organizationId: null,
      revalidatePaths: [] as const,
    };
  }

  return {
    cookieAction: "set" as const,
    organizationId: args.requestedOrganizationId ?? null,
    revalidatePaths: ORG_REVALIDATE_PATHS,
  };
}

export function planImpersonationChange(args: {
  realRole: AppUserRole | null | undefined;
  realUserId: string | null | undefined;
  currentOrganizationId: string | null | undefined;
  targetUserId: string | null | undefined;
  targetUserActive: boolean;
  targetMembershipOrganizationId: string | null | undefined;
}) {
  const decision = getImpersonationDecision(args);

  if (decision === "clear") {
    return {
      cookieAction: "clear" as const,
      impersonatedUserId: null,
      revalidatePaths: IMPERSONATION_REVALIDATE_PATHS,
    };
  }

  if (decision === "reject") {
    return {
      cookieAction: "noop" as const,
      impersonatedUserId: null,
      revalidatePaths: [] as const,
    };
  }

  return {
    cookieAction: "set" as const,
    impersonatedUserId: args.targetUserId ?? null,
    revalidatePaths: IMPERSONATION_REVALIDATE_PATHS,
  };
}
