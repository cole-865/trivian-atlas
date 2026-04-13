export type UserRole = "sales" | "management" | "admin" | "dev";

export type Permission =
  | "view_own_deals"
  | "view_all_deals"
  | "edit_deals"
  | "select_vehicle"
  | "submit_deal"
  | "view_decision"
  | "fund_deal"
  | "manage_users"
  | "edit_settings"
  | "override_workflow"
  | "access_debug_tools";

const rolePermissions: Record<UserRole, Permission[]> = {
  sales: [
    "view_own_deals",
    "edit_deals",
    "select_vehicle",
    "submit_deal",
    "view_decision",
  ],

  management: [
    "view_all_deals",
    "edit_deals",
    "select_vehicle",
    "submit_deal",
    "view_decision",
    "fund_deal",
    "override_workflow",
  ],

  admin: [
    "view_all_deals",
    "edit_deals",
    "select_vehicle",
    "submit_deal",
    "view_decision",
    "fund_deal",
    "manage_users",
    "edit_settings",
    "override_workflow",
  ],

  dev: [
    "view_all_deals",
    "edit_deals",
    "select_vehicle",
    "submit_deal",
    "view_decision",
    "fund_deal",
    "manage_users",
    "edit_settings",
    "override_workflow",
    "access_debug_tools",
  ],
};

export function hasPermission(role: UserRole, permission: Permission) {
  return rolePermissions[role]?.includes(permission);
}
