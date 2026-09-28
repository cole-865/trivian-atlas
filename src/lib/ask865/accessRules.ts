import type { AuthContext } from "../auth/userRole";

// Require database-backed active profiles. Legacy metadata role fallbacks must
// never grant reporting access or platform module administration.
export function isAsk865PlatformDev(context: AuthContext) {
  return !!context.realUser && context.realProfile?.id === context.realUser.id &&
    context.realProfile.isActive && context.realProfile.role === "dev" &&
    !context.isImpersonating;
}

export function hasAsk865OrganizationIdentity(context: AuthContext) {
  if (!context.realUser || !context.realProfile?.isActive ||
      context.realProfile.id !== context.realUser.id ||
      !context.currentOrganizationId || !context.currentOrganization?.isActive ||
      context.currentOrganization.id !== context.currentOrganizationId) return false;
  if (isAsk865PlatformDev(context)) return true;
  const member = context.effectiveOrganizationMembership;
  return !!context.effectiveProfile?.isActive && !!member?.isActive &&
    member.organizationId === context.currentOrganizationId &&
    member.userId === context.effectiveProfile.id &&
    member.role === context.effectiveOrganizationRole &&
    (context.isImpersonating
      ? context.realProfile.role === "dev"
      : context.effectiveProfile.id === context.realUser.id);
}

export function matchesAsk865Organization(current: string, expected: string | null) {
  return expected === current;
}
