import type { OrganizationScopedRole } from "./accessRules";
import {
  DEALERSHIP_PERMISSION_KEYS,
  getDefaultRolePermissionAllowed,
  isDealershipPermissionKey,
  type DealershipPermissionKey,
} from "./permissionRegistry";

export type RolePermissionRuleRow = {
  role: OrganizationScopedRole;
  permission_key: DealershipPermissionKey;
  allowed: boolean;
};

export type UserPermissionOverrideRuleRow = {
  permission_key: DealershipPermissionKey;
  allowed: boolean;
};

export type ResolvedDealershipPermissions = Record<
  DealershipPermissionKey,
  boolean
>;

function emptyPermissions() {
  return Object.fromEntries(
    DEALERSHIP_PERMISSION_KEYS.map((permission) => [permission, false])
  ) as ResolvedDealershipPermissions;
}

export function resolveDealershipPermissionsFromRows(args: {
  role: OrganizationScopedRole;
  roleRows: RolePermissionRuleRow[];
  overrideRows: UserPermissionOverrideRuleRow[];
}) {
  const resolved = emptyPermissions();

  for (const permission of DEALERSHIP_PERMISSION_KEYS) {
    resolved[permission] = getDefaultRolePermissionAllowed(args.role, permission);
  }

  for (const row of args.roleRows) {
    if (row.role === args.role && isDealershipPermissionKey(row.permission_key)) {
      resolved[row.permission_key] = row.allowed;
    }
  }

  for (const row of args.overrideRows) {
    if (isDealershipPermissionKey(row.permission_key)) {
      resolved[row.permission_key] = row.allowed;
    }
  }

  return resolved;
}
