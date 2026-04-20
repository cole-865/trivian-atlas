import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthContext } from "@/lib/auth/userRole";
import type { OrganizationScopedRole } from "@/lib/auth/accessRules";
import {
  DEALERSHIP_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSION_PRESETS,
  isDealershipPermissionKey,
  type DealershipPermissionKey,
} from "@/lib/auth/permissionRegistry";
import {
  resolveDealershipPermissionsFromRows,
  type ResolvedDealershipPermissions,
} from "@/lib/auth/dealershipPermissionRules";

export type RolePermissionRow = {
  organization_id: string;
  role: OrganizationScopedRole;
  permission_key: DealershipPermissionKey;
  allowed: boolean;
};

export type UserPermissionOverrideRow = {
  organization_id: string;
  user_id: string;
  permission_key: DealershipPermissionKey;
  allowed: boolean;
};

type PermissionLoadResult = {
  roleRows: RolePermissionRow[];
  overrideRows: UserPermissionOverrideRow[];
};

const permissionCache = new Map<
  string,
  { expiresAt: number; value: Promise<ResolvedDealershipPermissions> }
>();
const PERMISSION_CACHE_TTL_MS = 2_000;

function cacheKey(organizationId: string, userId: string, role: string) {
  return `${organizationId}:${userId}:${role}`;
}

function isOrgScopedRole(value: unknown): value is OrganizationScopedRole {
  return value === "sales" || value === "management" || value === "admin";
}

export { resolveDealershipPermissionsFromRows };

async function loadPermissionRows(args: {
  organizationId: string;
  userId: string;
}): Promise<PermissionLoadResult> {
  const admin = createAdminClient();
  const [rolePermissions, userOverrides] = await Promise.all([
    admin
      .from("organization_role_permissions")
      .select("organization_id, role, permission_key, allowed")
      .eq("organization_id", args.organizationId),
    admin
      .from("organization_user_permission_overrides")
      .select("organization_id, user_id, permission_key, allowed")
      .eq("organization_id", args.organizationId)
      .eq("user_id", args.userId),
  ]);

  if (rolePermissions.error) {
    throw new Error(
      `Failed to load role permissions: ${rolePermissions.error.message}`
    );
  }

  if (userOverrides.error) {
    throw new Error(
      `Failed to load user permission overrides: ${userOverrides.error.message}`
    );
  }

  return {
    roleRows: ((rolePermissions.data ?? []) as RolePermissionRow[]).filter(
      (row) => isOrgScopedRole(row.role) && isDealershipPermissionKey(row.permission_key)
    ),
    overrideRows: ((userOverrides.data ?? []) as UserPermissionOverrideRow[]).filter(
      (row) => isDealershipPermissionKey(row.permission_key)
    ),
  };
}

export const loadResolvedDealershipPermissionsForRequest = cache(
  async (args: {
    organizationId: string;
    userId: string;
    role: OrganizationScopedRole;
  }) => {
    const rows = await loadPermissionRows(args);
    return resolveDealershipPermissionsFromRows({
      role: args.role,
      ...rows,
    });
  }
);

export async function getResolvedDealershipPermissions(args: {
  organizationId: string;
  userId: string;
  role: OrganizationScopedRole;
}) {
  const key = cacheKey(args.organizationId, args.userId, args.role);
  const cached = permissionCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = loadResolvedDealershipPermissionsForRequest(args);
  permissionCache.set(key, {
    expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
    value,
  });

  return value;
}

export function clearDealershipPermissionCache(args?: {
  organizationId?: string;
  userId?: string;
}) {
  if (!args?.organizationId && !args?.userId) {
    permissionCache.clear();
    return;
  }

  for (const key of permissionCache.keys()) {
    const [organizationId, userId] = key.split(":");
    if (
      (!args.organizationId || organizationId === args.organizationId) &&
      (!args.userId || userId === args.userId)
    ) {
      permissionCache.delete(key);
    }
  }
}

export function canPlatformDevManage(authContext: AuthContext) {
  return authContext.realRole === "dev" && !authContext.isImpersonating;
}

export async function hasDealershipPermission(
  authContext: AuthContext,
  permission: DealershipPermissionKey
) {
  if (canPlatformDevManage(authContext)) {
    return true;
  }

  const organizationId = authContext.currentOrganizationId;
  const userId = authContext.effectiveProfile?.id ?? authContext.realUser?.id ?? null;
  const role = authContext.effectiveOrganizationRole;

  if (!organizationId || !userId || !isOrgScopedRole(role)) {
    return false;
  }

  const permissions = await getResolvedDealershipPermissions({
    organizationId,
    userId,
    role,
  });

  return permissions[permission];
}

export async function requireDealershipPermission(
  authContext: AuthContext,
  permission: DealershipPermissionKey
) {
  if (await hasDealershipPermission(authContext, permission)) {
    return;
  }

  throw new Error("You do not have permission to change this account setting.");
}

export function buildDefaultRolePermissionRows(organizationId: string) {
  return (Object.entries(DEFAULT_ROLE_PERMISSION_PRESETS) as Array<
    [OrganizationScopedRole, readonly DealershipPermissionKey[]]
  >).flatMap(([role, allowedPermissions]) =>
    DEALERSHIP_PERMISSION_KEYS.map((permission) => ({
      organization_id: organizationId,
      role,
      permission_key: permission,
      allowed: allowedPermissions.includes(permission),
      updated_at: new Date().toISOString(),
    }))
  );
}

export async function seedDefaultRolePermissionsForOrganization(
  organizationId: string
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("organization_role_permissions")
    .upsert(buildDefaultRolePermissionRows(organizationId), {
      onConflict: "organization_id,role,permission_key",
    });

  if (error) {
    throw new Error(`Failed to seed role permissions: ${error.message}`);
  }
}

export async function listActiveOrganizationUsersWithPermission(
  organizationId: string,
  permission: DealershipPermissionKey
) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_users")
    .select("user_id, role, is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to load organization permission users: ${error.message}`);
  }

  const memberships = ((data ?? []) as Array<{
    user_id: string;
    role: string;
    is_active: boolean;
  }>)
    .map((row) =>
      isOrgScopedRole(row.role)
        ? { ...row, role: row.role }
        : null
    )
    .filter(
      (
        row
      ): row is { user_id: string; role: OrganizationScopedRole; is_active: boolean } =>
        !!row
    );
  const allowedUserIds: string[] = [];

  for (const membership of memberships) {
    const permissions = await getResolvedDealershipPermissions({
      organizationId,
      userId: membership.user_id,
      role: membership.role,
    });
    if (permissions[permission]) {
      allowedUserIds.push(membership.user_id);
    }
  }

  return allowedUserIds;
}
