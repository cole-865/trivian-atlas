import type { OrganizationScopedRole } from "@/lib/auth/accessRules";

export const DEALERSHIP_PERMISSION_KEYS = [
  "view_deals",
  "edit_deals",
  "submit_deals",
  "fund_deals",
  "approve_overrides",
  "manage_users",
  "manage_underwriting_settings",
  "manage_workflow_settings",
  "view_audit_logs",
  "manage_integrations",
  "export_reports",
] as const;

export type DealershipPermissionKey = (typeof DEALERSHIP_PERMISSION_KEYS)[number];

export type DealershipPermissionPreset = Record<
  OrganizationScopedRole,
  readonly DealershipPermissionKey[]
>;

export const DEFAULT_ROLE_PERMISSION_PRESETS: DealershipPermissionPreset = {
  sales: ["view_deals", "edit_deals", "submit_deals"],
  management: [
    "view_deals",
    "edit_deals",
    "submit_deals",
    "fund_deals",
    "approve_overrides",
  ],
  admin: DEALERSHIP_PERMISSION_KEYS,
};

export function isDealershipPermissionKey(
  value: unknown
): value is DealershipPermissionKey {
  return (
    typeof value === "string" &&
    DEALERSHIP_PERMISSION_KEYS.includes(value as DealershipPermissionKey)
  );
}

export function getDefaultRolePermissionAllowed(
  role: OrganizationScopedRole,
  permission: DealershipPermissionKey
) {
  return DEFAULT_ROLE_PERMISSION_PRESETS[role].includes(permission);
}
