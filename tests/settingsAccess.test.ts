import test from "node:test";
import assert from "node:assert/strict";
import {
  canAccessAnySettingsSection,
  getSettingsSectionAccess,
} from "../src/lib/auth/settingsAccess.js";
import type { ResolvedDealershipPermissions } from "../src/lib/auth/dealershipPermissionRules.js";

function permissions(
  overrides: Partial<ResolvedDealershipPermissions>
): ResolvedDealershipPermissions {
  return {
    view_deals: false,
    edit_deals: false,
    submit_deals: false,
    fund_deals: false,
    approve_overrides: false,
    manage_users: false,
    manage_underwriting_settings: false,
    manage_workflow_settings: false,
    view_audit_logs: false,
    manage_integrations: false,
    export_reports: false,
    ...overrides,
  };
}

test("sales users do not get visible settings sections by default", () => {
  const access = getSettingsSectionAccess({
    currentOrganizationId: "org-1",
    effectiveOrganizationRole: "sales",
    permissions: permissions({
      view_deals: true,
      edit_deals: true,
      submit_deals: true,
    }),
    platformDev: false,
  });

  assert.equal(canAccessAnySettingsSection(access), false);
  assert.equal(access.general, false);
  assert.equal(access.underwriting, false);
  assert.equal(access.permissions, false);
});

test("management users only get user-management settings from default access", () => {
  const access = getSettingsSectionAccess({
    currentOrganizationId: "org-1",
    effectiveOrganizationRole: "management",
    permissions: permissions({
      view_deals: true,
      edit_deals: true,
      submit_deals: true,
      fund_deals: true,
      approve_overrides: true,
      manage_users: true,
    }),
    platformDev: false,
  });

  assert.equal(access.general, true);
  assert.equal(access.users, true);
  assert.equal(access.permissions, false);
  assert.equal(access.underwriting, false);
  assert.equal(access.workflow, false);
  assert.equal(access.notifications, false);
});

test("organization admins can manage permissions when they have manage_users", () => {
  const access = getSettingsSectionAccess({
    currentOrganizationId: "org-1",
    effectiveOrganizationRole: "admin",
    permissions: permissions({
      manage_users: true,
      manage_underwriting_settings: true,
      manage_workflow_settings: true,
      manage_integrations: true,
      view_audit_logs: true,
    }),
    platformDev: false,
  });

  assert.equal(access.general, true);
  assert.equal(access.permissions, true);
  assert.equal(access.underwriting, true);
  assert.equal(access.audit, true);
});

test("platform dev can access every settings section", () => {
  const access = getSettingsSectionAccess({
    currentOrganizationId: "org-1",
    effectiveOrganizationRole: null,
    permissions: null,
    platformDev: true,
  });

  assert.equal(canAccessAnySettingsSection(access), true);
  assert.equal(
    Object.values(access).every(Boolean),
    true
  );
});
