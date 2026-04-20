import { randomBytes, createHash } from "node:crypto";
import type { AuthContext } from "@/lib/auth/userRole";
import type { UserRole } from "@/lib/auth/permissions";
import {
  ORG_MANAGED_ROLES,
  canCreateOrganizationsForRole,
  canManageCurrentOrganizationForRole,
  getInviteAcceptanceBlockReason,
  isPlatformDevRole,
} from "@/lib/auth/accessRules";
import { setStoredCurrentOrganizationId } from "@/lib/auth/organizationContext";
import { sendOrganizationInviteEmail } from "@/lib/email/notifications";
import { seedDefaultRolePermissionsForOrganization } from "@/lib/auth/dealershipPermissions";
import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.generated";
export { ORG_MANAGED_ROLES } from "@/lib/auth/accessRules";

export type OrgManagedRole = (typeof ORG_MANAGED_ROLES)[number];
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type OrganizationUserRow = {
  organization_id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type UserProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
  role: string;
  created_at: string;
  updated_at: string;
};

type InvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  full_name: string | null;
  role: string;
  invited_by_user_id: string | null;
  token_hash: string;
  status: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

type AdminUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: {
    full_name?: string | null;
    name?: string | null;
  } | null;
};

type SwitchableOrganization = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  roleLabel: string;
};

export type OrganizationMemberRecord = {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: OrgManagedRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationInviteRecord = {
  id: string;
  email: string;
  fullName: string | null;
  role: OrgManagedRole;
  invitedBy: string;
  status: InvitationStatus;
  sentAt: string;
  expiresAt: string;
};

export type OrganizationManagementData = {
  activeUsers: OrganizationMemberRecord[];
  inactiveUsers: OrganizationMemberRecord[];
  pendingInvites: OrganizationInviteRecord[];
};

export type InviteValidationResult = {
  invite: OrganizationInviteRecord | null;
  organization: SwitchableOrganization | null;
  isExpired: boolean;
};

type VehicleTermPolicyInsert = Database["public"]["Tables"]["vehicle_term_policy"]["Insert"];
type UnderwritingTierPolicyInsert =
  Database["public"]["Tables"]["underwriting_tier_policy"]["Insert"];
type TrivianConfigInsert = Database["public"]["Tables"]["trivian_config"]["Insert"];

type CreateOrganizationInput = {
  name: string;
  slug: string;
  initialAdminName: string;
  initialAdminEmail: string;
  createdByUserId: string;
};

export type CreateOrganizationResult = {
  organization: {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  };
  initialInvite: OrganizationInviteResult;
};

type CreateInviteInput = {
  organizationId: string;
  email: string;
  fullName: string;
  role: OrgManagedRole;
  invitedByUserId: string;
};

export type OrganizationInviteResult = {
  id: string;
  acceptUrl: string;
  emailDelivery: {
    sent: boolean;
    reason: string | null;
  };
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isOrgManagedRole(value: string): value is OrgManagedRole {
  return ORG_MANAGED_ROLES.includes(value as OrgManagedRole);
}

function resolveInvitationStatus(row: InvitationRow): InvitationStatus {
  if (row.status === "accepted") {
    return "accepted";
  }

  if (row.status === "revoked") {
    return "revoked";
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return "expired";
  }

  return "pending";
}

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createInviteToken() {
  return randomBytes(32).toString("hex");
}

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function buildInviteUrl(token: string) {
  return `${getSiteUrl()}/invite/accept?token=${encodeURIComponent(token)}`;
}

function getClonePolicyErrorMessage(errorMessage: string) {
  if (errorMessage.includes("underwriting_tier_policy_tier_key")) {
    return "Failed to clone account defaults because underwriting tier policy is still globally unique by tier. Apply docs/supabase/organization-management.sql to replace that constraint with an account-scoped unique index, then try again.";
  }

  return `Failed to clone underwriting tier policy defaults: ${errorMessage}`;
}

function buildInvitationRecord(
  row: InvitationRow,
  invitedByLookup: Map<string, string>
): OrganizationInviteRecord | null {
  if (!isOrgManagedRole(row.role)) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    invitedBy:
      invitedByLookup.get(row.invited_by_user_id ?? "") ??
      row.invited_by_user_id ??
      "Unknown user",
    status: resolveInvitationStatus(row),
    sentAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

async function getUserLookup(
  userIds: string[]
): Promise<Map<string, { email: string | null; fullName: string | null }>> {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const lookup = new Map<string, { email: string | null; fullName: string | null }>();

  if (!uniqueUserIds.length) {
    return lookup;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_profiles")
    .select("id, email, full_name")
    .in("id", uniqueUserIds);

  if (error) {
    throw new Error(`Failed to load user profiles: ${error.message}`);
  }

  for (const row of (data ?? []) as Array<Pick<UserProfileRow, "id" | "email" | "full_name">>) {
    lookup.set(row.id, {
      email: row.email,
      fullName: row.full_name,
    });
  }

  return lookup;
}

async function ensureUserProfile(args: {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: UserRole;
}) {
  const admin = createAdminClient();
  const timestamp = new Date().toISOString();

  const { error } = await admin.from("user_profiles").upsert(
    {
      id: args.userId,
      email: args.email,
      full_name: args.fullName,
      role: args.role,
      is_active: true,
      updated_at: timestamp,
    },
    { onConflict: "id" }
  );

  if (error) {
    throw new Error(`Failed to ensure user profile: ${error.message}`);
  }
}

async function getOrganizationById(organizationId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("id, name, slug, is_active, created_at, updated_at")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load organization: ${error.message}`);
  }

  return (data as OrganizationRow | null) ?? null;
}

export function slugifyOrganizationName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function isPlatformDev(authContext: AuthContext) {
  return isPlatformDevRole(authContext.realRole);
}

export function canManageCurrentOrganization(authContext: AuthContext) {
  return canManageCurrentOrganizationForRole({
    currentOrganizationId: authContext.currentOrganizationId,
    isImpersonating: authContext.isImpersonating,
    realRole: authContext.realRole,
    effectiveOrganizationRole: authContext.effectiveOrganizationRole,
  });
}

export function canCreateOrganizations(authContext: AuthContext) {
  return canCreateOrganizationsForRole(authContext.realRole);
}

export async function getSwitchableOrganizations(
  authContext: AuthContext
): Promise<SwitchableOrganization[]> {
  if (isPlatformDev(authContext)) {
    if (!hasAdminAccess()) {
      return authContext.availableOrganizationMemberships.map((membership) => ({
        id: membership.organizationId,
        name: membership.organization.name,
        slug: membership.organization.slug,
        isActive: membership.organization.isActive,
        roleLabel: membership.role,
      }));
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("organizations")
      .select("id, name, slug, is_active, created_at, updated_at")
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`Failed to load organizations: ${error.message}`);
    }

    return ((data ?? []) as OrganizationRow[]).map((organization) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      isActive: organization.is_active,
      roleLabel: "platform dev",
    }));
  }

  return authContext.availableOrganizationMemberships.map((membership) => ({
    id: membership.organizationId,
    name: membership.organization.name,
    slug: membership.organization.slug,
    isActive: membership.organization.isActive,
    roleLabel: membership.role,
  }));
}

export async function loadOrganizationManagementData(
  organizationId: string
): Promise<OrganizationManagementData> {
  if (!hasAdminAccess()) {
    return {
      activeUsers: [],
      inactiveUsers: [],
      pendingInvites: [],
    };
  }

  const admin = createAdminClient();
  const { data: membershipData, error: membershipError } = await admin
    .from("organization_users")
    .select(
      "organization_id, user_id, role, is_active, created_at, updated_at"
    )
    .eq("organization_id", organizationId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: true });

  if (membershipError) {
    throw new Error(`Failed to load organization memberships: ${membershipError.message}`);
  }

  const memberships = (membershipData ?? []) as OrganizationUserRow[];
  const userLookup = await getUserLookup(memberships.map((membership) => membership.user_id));

  const mappedMemberships = memberships
    .map((membership) => {
      if (!isOrgManagedRole(membership.role)) {
        return null;
      }

      const profile = userLookup.get(membership.user_id);

      return {
        userId: membership.user_id,
        email: profile?.email ?? null,
        fullName: profile?.fullName ?? null,
        role: membership.role,
        isActive: membership.is_active,
        createdAt: membership.created_at,
        updatedAt: membership.updated_at,
      } satisfies OrganizationMemberRecord;
    })
    .filter((membership): membership is OrganizationMemberRecord => !!membership)
    .sort((a, b) => {
      const aLabel = `${a.fullName ?? ""} ${a.email ?? ""}`.trim().toLowerCase();
      const bLabel = `${b.fullName ?? ""} ${b.email ?? ""}`.trim().toLowerCase();
      return aLabel.localeCompare(bLabel);
    });

  const { data: inviteData, error: inviteError } = await admin
    .from("organization_invitations")
    .select(
      "id, organization_id, email, full_name, role, invited_by_user_id, token_hash, status, expires_at, accepted_at, accepted_by_user_id, revoked_at, created_at, updated_at"
    )
    .eq("organization_id", organizationId)
    .neq("status", "accepted")
    .order("created_at", { ascending: false });

  if (inviteError) {
    throw new Error(`Failed to load organization invitations: ${inviteError.message}`);
  }

  const invites = (inviteData ?? []) as InvitationRow[];
  const inviterLookup = await getUserLookup(
    invites.map((invite) => invite.invited_by_user_id ?? "")
  );
  const invitedByText = new Map<string, string>();

  for (const [userId, profile] of inviterLookup) {
    invitedByText.set(userId, profile.fullName || profile.email || userId);
  }

  const pendingInvites = invites
    .map((invite) => buildInvitationRecord(invite, invitedByText))
    .filter((invite): invite is OrganizationInviteRecord => !!invite)
    .filter((invite) => invite.status !== "accepted");

  return {
    activeUsers: mappedMemberships.filter((membership) => membership.isActive),
    inactiveUsers: mappedMemberships.filter((membership) => !membership.isActive),
    pendingInvites,
  };
}

async function findInviteByEmail(organizationId: string, email: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_invitations")
    .select(
      "id, organization_id, email, full_name, role, invited_by_user_id, token_hash, status, expires_at, accepted_at, accepted_by_user_id, revoked_at, created_at, updated_at"
    )
    .eq("organization_id", organizationId)
    .eq("email", normalizeEmail(email))
    .neq("status", "accepted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load existing invitation: ${error.message}`);
  }

  return (data as InvitationRow | null) ?? null;
}

async function upsertInvite(input: CreateInviteInput): Promise<OrganizationInviteResult> {
  const admin = createAdminClient();
  const existingInvite = await findInviteByEmail(input.organizationId, input.email);
  const token = createInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const timestamp = new Date().toISOString();

  const payload = {
    organization_id: input.organizationId,
    email: normalizeEmail(input.email),
    full_name: input.fullName.trim() || null,
    role: input.role,
    invited_by_user_id: input.invitedByUserId,
    token_hash: tokenHash,
    status: "pending",
    expires_at: expiresAt,
    accepted_at: null,
    accepted_by_user_id: null,
    revoked_at: null,
    updated_at: timestamp,
  };

  const response = existingInvite
    ? await admin
        .from("organization_invitations")
        .update(payload)
        .eq("id", existingInvite.id)
        .select(
          "id, organization_id, email, full_name, role, invited_by_user_id, token_hash, status, expires_at, accepted_at, accepted_by_user_id, revoked_at, created_at, updated_at"
        )
        .maybeSingle()
    : await admin
        .from("organization_invitations")
        .insert(payload)
        .select(
          "id, organization_id, email, full_name, role, invited_by_user_id, token_hash, status, expires_at, accepted_at, accepted_by_user_id, revoked_at, created_at, updated_at"
        )
        .maybeSingle();

  if (response.error) {
    throw new Error(`Failed to save invitation: ${response.error.message}`);
  }

  const row = response.data as InvitationRow | null;

  if (!row) {
    throw new Error("Invitation save did not return a row.");
  }

  const inviteResult = {
    id: row.id,
    acceptUrl: buildInviteUrl(token),
  };

  const emailDelivery = await sendOrganizationInviteEmail({
    organizationId: input.organizationId,
    inviteeEmail: normalizeEmail(input.email),
    inviteeFullName: input.fullName.trim() || null,
    invitedByUserId: input.invitedByUserId,
    role: input.role,
    acceptUrl: inviteResult.acceptUrl,
  }).catch((error) => ({
    sent: false,
    reason: error instanceof Error ? error.message : "Unable to send the invitation email.",
  }));

  return {
    ...inviteResult,
    emailDelivery,
  };
}

export async function createOrganizationInvite(input: CreateInviteInput) {
  return upsertInvite(input);
}

export async function resendOrganizationInvite(
  inviteId: string,
  organizationId: string,
  invitedByUserId: string
) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_invitations")
    .select(
      "id, organization_id, email, full_name, role, invited_by_user_id, token_hash, status, expires_at, accepted_at, accepted_by_user_id, revoked_at, created_at, updated_at"
    )
    .eq("id", inviteId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load invitation: ${error.message}`);
  }

  const invite = data as InvitationRow | null;

  if (!invite || !isOrgManagedRole(invite.role)) {
    throw new Error("Invitation not found.");
  }

  if (resolveInvitationStatus(invite) === "accepted") {
    throw new Error("Accepted invitations cannot be resent.");
  }

  return upsertInvite({
    organizationId: invite.organization_id,
    email: invite.email,
    fullName: invite.full_name ?? "",
    role: invite.role,
    invitedByUserId,
  });
}

export async function revokeOrganizationInvite(inviteId: string, organizationId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("organization_invitations")
    .update({
      status: "revoked",
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", inviteId)
    .eq("organization_id", organizationId)
    .neq("status", "accepted");

  if (error) {
    throw new Error(`Failed to revoke invitation: ${error.message}`);
  }
}

export async function updateOrganizationMembership(args: {
  organizationId: string;
  userId: string;
  role?: OrgManagedRole;
  isActive?: boolean;
}) {
  const admin = createAdminClient();
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (args.role) {
    update.role = args.role;
  }

  if (typeof args.isActive === "boolean") {
    update.is_active = args.isActive;
  }

  const { error } = await admin
    .from("organization_users")
    .update(update)
    .eq("organization_id", args.organizationId)
    .eq("user_id", args.userId);

  if (error) {
    throw new Error(`Failed to update organization membership: ${error.message}`);
  }
}

async function cloneOrganizationDefaults(sourceOrganizationId: string, targetOrganizationId: string) {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const [vehiclePolicies, tierPolicies, configs] = await Promise.all([
    admin.from("vehicle_term_policy").select("*").eq("organization_id", sourceOrganizationId),
    admin
      .from("underwriting_tier_policy")
      .select("*")
      .eq("organization_id", sourceOrganizationId),
    admin.from("trivian_config").select("*").eq("organization_id", sourceOrganizationId),
  ]);

  if (vehiclePolicies.error) {
    throw new Error(`Failed to load vehicle term policy defaults: ${vehiclePolicies.error.message}`);
  }

  if (tierPolicies.error) {
    throw new Error(
      `Failed to load underwriting tier policy defaults: ${tierPolicies.error.message}`
    );
  }

  if (configs.error) {
    throw new Error(`Failed to load trivian config defaults: ${configs.error.message}`);
  }

  if (!(vehiclePolicies.data ?? []).length) {
    throw new Error("Default organization has no vehicle term policy rows to clone.");
  }

  if (!(tierPolicies.data ?? []).length) {
    throw new Error("Default organization has no underwriting tier policy rows to clone.");
  }

  if (!(configs.data ?? []).length) {
    throw new Error("Default organization has no trivian config rows to clone.");
  }

  const vehiclePolicyInsert = (vehiclePolicies.data ?? []).map((row) => {
    const source = row as Database["public"]["Tables"]["vehicle_term_policy"]["Row"];
    return {
      active: source.active,
      max_mileage: source.max_mileage,
      max_term_months: source.max_term_months,
      max_vehicle_age: source.max_vehicle_age,
      min_mileage: source.min_mileage,
      min_vehicle_age: source.min_vehicle_age,
      notes: source.notes,
      organization_id: targetOrganizationId,
      sort_order: source.sort_order,
      created_at: now,
      updated_at: now,
    } satisfies VehicleTermPolicyInsert;
  });

  const tierPolicyInsert = (tierPolicies.data ?? []).map((row) => {
    const source = row as Database["public"]["Tables"]["underwriting_tier_policy"]["Row"];
    return {
      active: source.active,
      apr: source.apr,
      max_amount_financed: source.max_amount_financed,
      max_ltv: source.max_ltv,
      max_pti: source.max_pti,
      max_term_months: source.max_term_months,
      max_vehicle_price: source.max_vehicle_price,
      min_cash_down: source.min_cash_down,
      min_down_pct: source.min_down_pct,
      organization_id: targetOrganizationId,
      sort_order: source.sort_order,
      tier: source.tier,
      created_at: now,
      updated_at: now,
    } satisfies UnderwritingTierPolicyInsert;
  });

  const configInsert = (configs.data ?? []).map((row) => {
    const source = row as Database["public"]["Tables"]["trivian_config"]["Row"];
    return {
      apr: source.apr,
      doc_fee: source.doc_fee,
      gap_price: source.gap_price,
      organization_id: targetOrganizationId,
      payment_cap_pct: source.payment_cap_pct,
      tax_add_base: source.tax_add_base,
      tax_add_rate: source.tax_add_rate,
      tax_rate_main: source.tax_rate_main,
      title_license: source.title_license,
      vsc_price: source.vsc_price,
      created_at: now,
      updated_at: now,
    } satisfies TrivianConfigInsert;
  });

  const insertVehiclePolicies = await admin.from("vehicle_term_policy").insert(vehiclePolicyInsert);
  if (insertVehiclePolicies.error) {
    throw new Error(
      `Failed to clone vehicle term policy defaults: ${insertVehiclePolicies.error.message}`
    );
  }

  const insertTierPolicies = await admin
    .from("underwriting_tier_policy")
    .insert(tierPolicyInsert);
  if (insertTierPolicies.error) {
    throw new Error(getClonePolicyErrorMessage(insertTierPolicies.error.message));
  }

  const insertConfigs = await admin.from("trivian_config").insert(configInsert);
  if (insertConfigs.error) {
    throw new Error(`Failed to clone trivian config defaults: ${insertConfigs.error.message}`);
  }
}

async function cleanupFailedOrganizationCreation(organizationId: string) {
  const admin = createAdminClient();

  const cleanupSteps: Array<{
    label: string;
    run: () => Promise<{ error: { message: string } | null }>;
  }> = [
    {
      label: "organization invitations",
      run: async () =>
        admin.from("organization_invitations").delete().eq("organization_id", organizationId),
    },
    {
      label: "organization memberships",
      run: async () =>
        admin.from("organization_users").delete().eq("organization_id", organizationId),
    },
    {
      label: "vehicle term policy",
      run: async () =>
        admin.from("vehicle_term_policy").delete().eq("organization_id", organizationId),
    },
    {
      label: "underwriting tier policy",
      run: async () =>
        admin.from("underwriting_tier_policy").delete().eq("organization_id", organizationId),
    },
    {
      label: "trivian config",
      run: async () =>
        admin.from("trivian_config").delete().eq("organization_id", organizationId),
    },
    {
      label: "organization",
      run: async () => admin.from("organizations").delete().eq("id", organizationId),
    },
  ];

  const cleanupErrors: string[] = [];

  for (const step of cleanupSteps) {
    const { error } = await step.run();
    if (error) {
      cleanupErrors.push(`${step.label}: ${error.message}`);
    }
  }

  if (cleanupErrors.length) {
    throw new Error(
      `Failed to roll back organization creation cleanly: ${cleanupErrors.join("; ")}`
    );
  }
}

export async function createOrganization(
  input: CreateOrganizationInput
): Promise<CreateOrganizationResult> {
  const admin = createAdminClient();
  const normalizedSlug = slugifyOrganizationName(input.slug || input.name);

  if (!normalizedSlug) {
    throw new Error("Organization slug is required.");
  }

  const { data: existingOrganization, error: existingOrganizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", normalizedSlug)
    .maybeSingle();

  if (existingOrganizationError) {
    throw new Error(`Failed to validate organization slug: ${existingOrganizationError.message}`);
  }

  if (existingOrganization?.id) {
    throw new Error("An organization with that slug already exists.");
  }

  const { data: defaultOrganization, error: defaultOrganizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", "865-autos")
    .maybeSingle();

  if (defaultOrganizationError) {
    throw new Error(
      `Failed to load default organization template: ${defaultOrganizationError.message}`
    );
  }

  if (!defaultOrganization?.id) {
    throw new Error("Default organization 865-autos was not found.");
  }

  let organizationId: string | null = null;

  try {
    const { data: createdOrganization, error: createOrganizationError } = await admin
      .from("organizations")
      .insert({
        name: input.name.trim(),
        slug: normalizedSlug,
        is_active: true,
      })
      .select("id, name, slug, is_active, created_at, updated_at")
      .maybeSingle();

    if (createOrganizationError) {
      throw new Error(`Failed to create organization: ${createOrganizationError.message}`);
    }

    const organization = createdOrganization as OrganizationRow | null;

    if (!organization?.id) {
      throw new Error("Organization creation did not return a row.");
    }

    organizationId = organization.id;

    await cloneOrganizationDefaults(defaultOrganization.id, organization.id);
    await seedDefaultRolePermissionsForOrganization(organization.id);

    const initialInvite = await createOrganizationInvite({
      organizationId: organization.id,
      email: input.initialAdminEmail,
      fullName: input.initialAdminName,
      role: "admin",
      invitedByUserId: input.createdByUserId,
    });

    await setStoredCurrentOrganizationId(organization.id);

    return {
      organization,
      initialInvite,
    };
  } catch (error) {
    if (organizationId) {
      try {
        await cleanupFailedOrganizationCreation(organizationId);
      } catch (cleanupError) {
        const primaryMessage =
          error instanceof Error ? error.message : "Organization creation failed.";
        const cleanupMessage =
          cleanupError instanceof Error
            ? cleanupError.message
            : "Organization rollback failed.";

        throw new Error(`${primaryMessage} ${cleanupMessage}`);
      }
    }

    throw error;
  }
}

export async function setOrganizationActiveState(args: {
  organizationId: string;
  isActive: boolean;
}) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      is_active: args.isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.organizationId);

  if (error) {
    throw new Error(`Failed to update account state: ${error.message}`);
  }
}

export async function validateInviteToken(token: string): Promise<InviteValidationResult> {
  if (!token.trim()) {
    return {
      invite: null,
      organization: null,
      isExpired: false,
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_invitations")
    .select(
      "id, organization_id, email, full_name, role, invited_by_user_id, token_hash, status, expires_at, accepted_at, accepted_by_user_id, revoked_at, created_at, updated_at"
    )
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to validate invitation: ${error.message}`);
  }

  const inviteRow = data as InvitationRow | null;
  if (!inviteRow) {
    return {
      invite: null,
      organization: null,
      isExpired: false,
    };
  }

  const organization = await getOrganizationById(inviteRow.organization_id);
  const inviterLookup = await getUserLookup([inviteRow.invited_by_user_id ?? ""]);
  const invitedByText = new Map<string, string>();

  for (const [userId, profile] of inviterLookup) {
    invitedByText.set(userId, profile.fullName || profile.email || userId);
  }

  return {
    invite: buildInvitationRecord(inviteRow, invitedByText),
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          isActive: organization.is_active,
          roleLabel: "invited",
        }
      : null,
    isExpired: resolveInvitationStatus(inviteRow) === "expired",
  };
}

async function getAuthUserById(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);

  if (error) {
    throw new Error(`Failed to load auth user: ${error.message}`);
  }

  return (data.user as AdminUserLike | null) ?? null;
}

export async function acceptOrganizationInvite(args: {
  token: string;
  userId: string;
}) {
  const validation = await validateInviteToken(args.token);

  if (!validation.invite || !validation.organization) {
    throw new Error("Invitation not found.");
  }

  const authUser = await getAuthUserById(args.userId);
  const blockReason = getInviteAcceptanceBlockReason({
    status: validation.invite.status,
    isExpired: validation.isExpired,
    inviteEmail: validation.invite.email,
    authenticatedEmail: authUser?.email ?? null,
  });

  if (blockReason) {
    throw new Error(blockReason);
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { error: membershipError } = await admin.from("organization_users").upsert(
    {
      organization_id: validation.organization.id,
      user_id: args.userId,
      role: validation.invite.role,
      is_active: true,
      updated_at: now,
    },
    { onConflict: "organization_id,user_id" }
  );

  if (membershipError) {
    throw new Error(`Failed to activate organization membership: ${membershipError.message}`);
  }

  const fullName =
    authUser?.user_metadata?.full_name ??
    authUser?.user_metadata?.name ??
    validation.invite.fullName ??
    null;

  await ensureUserProfile({
    userId: args.userId,
    email: authUser?.email ?? validation.invite.email,
    fullName,
    role: validation.invite.role,
  });

  const { error: invitationError } = await admin
    .from("organization_invitations")
    .update({
      status: "accepted",
      accepted_at: now,
      accepted_by_user_id: args.userId,
      updated_at: now,
    })
    .eq("id", validation.invite.id);

  if (invitationError) {
    throw new Error(`Failed to mark invitation accepted: ${invitationError.message}`);
  }

  await setStoredCurrentOrganizationId(validation.organization.id);

  return validation.organization;
}
