import {
  isOrganizationAdminRole,
  type OrganizationScopedRole,
} from "./accessRules";
import type { ResolvedDealershipPermissions } from "./dealershipPermissionRules";

export const SETTINGS_SECTIONS = [
  "general",
  "users",
  "permissions",
  "underwriting",
  "workflow",
  "products",
  "notifications",
  "integrations",
  "audit",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type SettingsSectionAccess = Record<SettingsSection, boolean>;

function emptySettingsSectionAccess() {
  return Object.fromEntries(
    SETTINGS_SECTIONS.map((section) => [section, false])
  ) as SettingsSectionAccess;
}

export function getSettingsSectionAccess(args: {
  currentOrganizationId: string | null | undefined;
  effectiveOrganizationRole: OrganizationScopedRole | null | undefined;
  permissions: ResolvedDealershipPermissions | null;
  platformDev: boolean;
}) {
  if (!args.currentOrganizationId) {
    return emptySettingsSectionAccess();
  }

  if (args.platformDev) {
    return Object.fromEntries(
      SETTINGS_SECTIONS.map((section) => [section, true])
    ) as SettingsSectionAccess;
  }

  const permissions = args.permissions;
  const canManageUsers = !!permissions?.manage_users;
  const isOrgAdmin = isOrganizationAdminRole(args.effectiveOrganizationRole);

  return {
    general: canManageUsers,
    users: canManageUsers,
    permissions: canManageUsers && isOrgAdmin,
    underwriting: !!permissions?.manage_underwriting_settings,
    workflow: !!permissions?.manage_workflow_settings,
    products: !!permissions?.manage_underwriting_settings,
    notifications: !!permissions?.manage_integrations,
    integrations: !!permissions?.manage_integrations,
    audit: !!permissions?.view_audit_logs,
  };
}

export function canAccessAnySettingsSection(access: SettingsSectionAccess) {
  return SETTINGS_SECTIONS.some((section) => access[section]);
}
