import test from "node:test";
import assert from "node:assert/strict";
import {
  ORG_MANAGED_ROLES,
  canCreateOrganizationsForRole,
  canManageCurrentOrganizationForRole,
  getImpersonationDecision,
  getInviteAcceptanceBlockReason,
  getOrganizationSwitchDecision,
  isPlatformDevRole,
} from "../src/lib/auth/accessRules.js";

test("org-managed roles never expose dev", () => {
  assert.deepEqual(ORG_MANAGED_ROLES, ["sales", "management", "admin"]);
  assert.equal(ORG_MANAGED_ROLES.includes("dev" as never), false);
});

test("only platform dev can create organizations", () => {
  assert.equal(canCreateOrganizationsForRole("dev"), true);
  assert.equal(canCreateOrganizationsForRole("admin"), false);
  assert.equal(canCreateOrganizationsForRole("management"), false);
  assert.equal(canCreateOrganizationsForRole("sales"), false);
  assert.equal(canCreateOrganizationsForRole(null), false);
});

test("current-organization management is limited to org admins and platform dev", () => {
  assert.equal(
    canManageCurrentOrganizationForRole({
      currentOrganizationId: "org-1",
      realRole: "admin",
      effectiveOrganizationRole: "admin",
    }),
    true
  );

  assert.equal(
    canManageCurrentOrganizationForRole({
      currentOrganizationId: "org-1",
      realRole: "dev",
      effectiveOrganizationRole: "sales",
    }),
    true
  );

  assert.equal(
    canManageCurrentOrganizationForRole({
      currentOrganizationId: "org-1",
      realRole: "management",
      effectiveOrganizationRole: "management",
    }),
    false
  );

  assert.equal(
    canManageCurrentOrganizationForRole({
      currentOrganizationId: null,
      realRole: "dev",
      effectiveOrganizationRole: "admin",
    }),
    false
  );
});

test("invite acceptance is blocked for revoked, accepted, expired, and wrong-email cases", () => {
  assert.equal(
    getInviteAcceptanceBlockReason({
      status: "revoked",
      isExpired: false,
      inviteEmail: "invitee@example.com",
      authenticatedEmail: "invitee@example.com",
    }),
    "This invitation has been revoked."
  );

  assert.equal(
    getInviteAcceptanceBlockReason({
      status: "accepted",
      isExpired: false,
      inviteEmail: "invitee@example.com",
      authenticatedEmail: "invitee@example.com",
    }),
    "This invitation has already been accepted."
  );

  assert.equal(
    getInviteAcceptanceBlockReason({
      status: "pending",
      isExpired: true,
      inviteEmail: "invitee@example.com",
      authenticatedEmail: "invitee@example.com",
    }),
    "This invitation has expired."
  );

  assert.equal(
    getInviteAcceptanceBlockReason({
      status: "pending",
      isExpired: false,
      inviteEmail: "invitee@example.com",
      authenticatedEmail: "different@example.com",
    }),
    "You must sign in with the invited email address to accept this invitation."
  );

  assert.equal(
    getInviteAcceptanceBlockReason({
      status: "pending",
      isExpired: false,
      inviteEmail: "Invitee@Example.com",
      authenticatedEmail: "invitee@example.com",
    }),
    null
  );
});

test("invite acceptance requires the invited email and preserves status-based blocks", () => {
  assert.equal(
    getInviteAcceptanceBlockReason({
      status: "pending",
      isExpired: false,
      inviteEmail: "invitee@example.com",
      authenticatedEmail: null,
    }),
    "You must sign in with the invited email address to accept this invitation."
  );

  assert.equal(
    getInviteAcceptanceBlockReason({
      status: "pending",
      isExpired: false,
      inviteEmail: "Invitee@Example.com ",
      authenticatedEmail: " invitee@example.com",
    }),
    null
  );

  assert.equal(
    getInviteAcceptanceBlockReason({
      status: "revoked",
      isExpired: true,
      inviteEmail: "invitee@example.com",
      authenticatedEmail: "other@example.com",
    }),
    "This invitation has been revoked."
  );

  assert.equal(
    getInviteAcceptanceBlockReason({
      status: "accepted",
      isExpired: true,
      inviteEmail: "invitee@example.com",
      authenticatedEmail: "other@example.com",
    }),
    "This invitation has already been accepted."
  );
});

test("impersonation is limited to platform dev acting within the current organization", () => {
  assert.equal(
    getImpersonationDecision({
      realRole: "dev",
      realUserId: "real-user",
      currentOrganizationId: "org-1",
      targetUserId: "target-user",
      targetUserActive: true,
      targetMembershipOrganizationId: "org-1",
    }),
    "impersonate"
  );

  assert.equal(
    getImpersonationDecision({
      realRole: "dev",
      realUserId: "real-user",
      currentOrganizationId: "org-1",
      targetUserId: "real-user",
      targetUserActive: true,
      targetMembershipOrganizationId: "org-1",
    }),
    "clear"
  );

  assert.equal(
    getImpersonationDecision({
      realRole: "admin",
      realUserId: "real-user",
      currentOrganizationId: "org-1",
      targetUserId: "target-user",
      targetUserActive: true,
      targetMembershipOrganizationId: "org-1",
    }),
    "reject"
  );

  assert.equal(
    getImpersonationDecision({
      realRole: "dev",
      realUserId: "real-user",
      currentOrganizationId: "org-1",
      targetUserId: "target-user",
      targetUserActive: false,
      targetMembershipOrganizationId: "org-1",
    }),
    "reject"
  );

  assert.equal(
    getImpersonationDecision({
      realRole: "dev",
      realUserId: "real-user",
      currentOrganizationId: "org-1",
      targetUserId: "target-user",
      targetUserActive: true,
      targetMembershipOrganizationId: "org-2",
    }),
    "reject"
  );
});

test("impersonation rejects missing context before any cross-org action", () => {
  assert.equal(
    getImpersonationDecision({
      realRole: "dev",
      realUserId: null,
      currentOrganizationId: "org-1",
      targetUserId: "target-user",
      targetUserActive: true,
      targetMembershipOrganizationId: "org-1",
    }),
    "reject"
  );

  assert.equal(
    getImpersonationDecision({
      realRole: "dev",
      realUserId: "real-user",
      currentOrganizationId: null,
      targetUserId: "target-user",
      targetUserActive: true,
      targetMembershipOrganizationId: "org-1",
    }),
    "reject"
  );

  assert.equal(
    getImpersonationDecision({
      realRole: "dev",
      realUserId: "real-user",
      currentOrganizationId: "org-1",
      targetUserId: null,
      targetUserActive: true,
      targetMembershipOrganizationId: "org-1",
    }),
    "reject"
  );
});

test("platform dev role helper stays narrow", () => {
  assert.equal(isPlatformDevRole("dev"), true);
  assert.equal(isPlatformDevRole("admin"), false);
  assert.equal(isPlatformDevRole(null), false);
});

test("organization switching only allows visible organizations and supports clearing", () => {
  assert.equal(
    getOrganizationSwitchDecision({
      requestedOrganizationId: "",
      switchableOrganizationIds: ["org-1", "org-2"],
    }),
    "clear"
  );

  assert.equal(
    getOrganizationSwitchDecision({
      requestedOrganizationId: "org-2",
      switchableOrganizationIds: ["org-1", "org-2"],
    }),
    "set"
  );

  assert.equal(
    getOrganizationSwitchDecision({
      requestedOrganizationId: "org-3",
      switchableOrganizationIds: ["org-1", "org-2"],
    }),
    "reject"
  );
});

test("organization switching tolerates whitespace but still rejects invisible orgs", () => {
  assert.equal(
    getOrganizationSwitchDecision({
      requestedOrganizationId: " org-2 ",
      switchableOrganizationIds: ["org-1", "org-2"],
    }),
    "set"
  );

  assert.equal(
    getOrganizationSwitchDecision({
      requestedOrganizationId: " org-3 ",
      switchableOrganizationIds: ["org-1", "org-2"],
    }),
    "reject"
  );
});
