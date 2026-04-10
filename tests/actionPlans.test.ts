import test from "node:test";
import assert from "node:assert/strict";
import {
  planImpersonationChange,
  planOrganizationSwitch,
} from "../src/lib/auth/actionPlans.js";

test("organization switch plan clears cookie and revalidates expected paths", () => {
  assert.deepEqual(
    planOrganizationSwitch({
      requestedOrganizationId: "",
      switchableOrganizationIds: ["org-1"],
    }),
    {
      cookieAction: "clear",
      organizationId: null,
      revalidatePaths: ["/", "/settings", "/dev-tools"],
    }
  );
});

test("organization switch plan rejects invisible organizations without side effects", () => {
  assert.deepEqual(
    planOrganizationSwitch({
      requestedOrganizationId: "org-2",
      switchableOrganizationIds: ["org-1"],
    }),
    {
      cookieAction: "noop",
      organizationId: null,
      revalidatePaths: [],
    }
  );
});

test("organization switch plan sets cookie for visible organizations", () => {
  assert.deepEqual(
    planOrganizationSwitch({
      requestedOrganizationId: "org-1",
      switchableOrganizationIds: ["org-1"],
    }),
    {
      cookieAction: "set",
      organizationId: "org-1",
      revalidatePaths: ["/", "/settings", "/dev-tools"],
    }
  );
});

test("organization switch plan normalizes whitespace before setting the cookie", () => {
  assert.deepEqual(
    planOrganizationSwitch({
      requestedOrganizationId: " org-1 ",
      switchableOrganizationIds: ["org-1"],
    }),
    {
      cookieAction: "set",
      organizationId: "org-1",
      revalidatePaths: ["/", "/settings", "/dev-tools"],
    }
  );
});

test("impersonation plan rejects invalid targets without side effects", () => {
  assert.deepEqual(
    planImpersonationChange({
      realRole: "admin",
      realUserId: "real",
      currentOrganizationId: "org-1",
      targetUserId: "target",
      targetUserActive: true,
      targetMembershipOrganizationId: "org-1",
    }),
    {
      cookieAction: "noop",
      impersonatedUserId: null,
      revalidatePaths: [],
    }
  );
});

test("impersonation plan clears when dev chooses self", () => {
  assert.deepEqual(
    planImpersonationChange({
      realRole: "dev",
      realUserId: "real",
      currentOrganizationId: "org-1",
      targetUserId: "real",
      targetUserActive: true,
      targetMembershipOrganizationId: "org-1",
    }),
    {
      cookieAction: "clear",
      impersonatedUserId: null,
      revalidatePaths: ["/", "/settings"],
    }
  );
});

test("impersonation plan sets cookie for valid in-org target", () => {
  assert.deepEqual(
    planImpersonationChange({
      realRole: "dev",
      realUserId: "real",
      currentOrganizationId: "org-1",
      targetUserId: "target",
      targetUserActive: true,
      targetMembershipOrganizationId: "org-1",
    }),
    {
      cookieAction: "set",
      impersonatedUserId: "target",
      revalidatePaths: ["/", "/settings"],
    }
  );
});

test("impersonation plan noops for cross-org or inactive targets", () => {
  assert.deepEqual(
    planImpersonationChange({
      realRole: "dev",
      realUserId: "real",
      currentOrganizationId: "org-1",
      targetUserId: "target",
      targetUserActive: true,
      targetMembershipOrganizationId: "org-2",
    }),
    {
      cookieAction: "noop",
      impersonatedUserId: null,
      revalidatePaths: [],
    }
  );

  assert.deepEqual(
    planImpersonationChange({
      realRole: "dev",
      realUserId: "real",
      currentOrganizationId: "org-1",
      targetUserId: "target",
      targetUserActive: false,
      targetMembershipOrganizationId: "org-1",
    }),
    {
      cookieAction: "noop",
      impersonatedUserId: null,
      revalidatePaths: [],
    }
  );
});
