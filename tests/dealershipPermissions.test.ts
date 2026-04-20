import test from "node:test";
import assert from "node:assert/strict";
import {
  DEALERSHIP_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSION_PRESETS,
  isDealershipPermissionKey,
} from "../src/lib/auth/permissionRegistry.js";
import {
  resolveDealershipPermissionsFromRows,
  type RolePermissionRuleRow,
  type UserPermissionOverrideRuleRow,
} from "../src/lib/auth/dealershipPermissionRules.js";

test("dealership permission registry rejects arbitrary strings", () => {
  assert.equal(isDealershipPermissionKey("view_deals"), true);
  assert.equal(isDealershipPermissionKey("dev"), false);
  assert.equal(isDealershipPermissionKey("manage_everything"), false);
});

test("default role presets match requested seed values", () => {
  assert.deepEqual(DEFAULT_ROLE_PERMISSION_PRESETS.sales, [
    "view_deals",
    "edit_deals",
    "submit_deals",
  ]);
  assert.deepEqual(DEFAULT_ROLE_PERMISSION_PRESETS.management, [
    "view_deals",
    "edit_deals",
    "submit_deals",
    "fund_deals",
    "approve_overrides",
    "manage_users",
  ]);
  assert.deepEqual(DEFAULT_ROLE_PERMISSION_PRESETS.admin, DEALERSHIP_PERMISSION_KEYS);
});

test("resolved permissions use editable role rows and user overrides win", () => {
  const roleRows: RolePermissionRuleRow[] = [
    {
      role: "sales",
      permission_key: "submit_deals",
      allowed: false,
    },
    {
      role: "sales",
      permission_key: "manage_users",
      allowed: true,
    },
  ];
  const overrideRows: UserPermissionOverrideRuleRow[] = [
    {
      permission_key: "submit_deals",
      allowed: true,
    },
    {
      permission_key: "manage_users",
      allowed: false,
    },
  ];

  const resolved = resolveDealershipPermissionsFromRows({
    role: "sales",
    roleRows,
    overrideRows,
  });

  assert.equal(resolved.view_deals, true);
  assert.equal(resolved.submit_deals, true);
  assert.equal(resolved.fund_deals, false);
  assert.equal(resolved.manage_users, false);
  assert.equal(resolved.approve_overrides, false);
});
