import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { UserRole } from "@/lib/auth/permissions";

export const CURRENT_ORGANIZATION_COOKIE_NAME = "atlas_current_organization_id";

type AuthUserResult = {
  data: { user: User | null };
  error?: { message: string } | null;
};

type MembershipRow = {
  organization_id: string;
  user_id: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type SupabaseLike = {
  auth: {
    getUser: () => Promise<AuthUserResult>;
  };
  from: (table: string) => any;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationMembership = {
  organizationId: string;
  userId: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  organization: Organization;
};

function currentOrganizationCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

function mapOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getAuthenticatedUser(
  supabase: SupabaseLike
): Promise<User | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw new Error(`Failed to load current user: ${error.message}`);
  }

  return user;
}

export async function getStoredCurrentOrganizationId() {
  const cookieStore = await cookies();
  return cookieStore.get(CURRENT_ORGANIZATION_COOKIE_NAME)?.value ?? null;
}

export async function setStoredCurrentOrganizationId(organizationId: string) {
  const cookieStore = await cookies();
  cookieStore.set(
    CURRENT_ORGANIZATION_COOKIE_NAME,
    organizationId,
    currentOrganizationCookieOptions()
  );
}

export async function clearStoredCurrentOrganizationId() {
  const cookieStore = await cookies();
  cookieStore.delete(CURRENT_ORGANIZATION_COOKIE_NAME);
}

export async function getOrganizationMembershipsForUser(
  supabase: unknown,
  userId?: string | null
): Promise<OrganizationMembership[]> {
  const client = supabase as SupabaseLike;
  const resolvedUserId = userId ?? (await getAuthenticatedUser(client))?.id ?? null;

  if (!resolvedUserId) {
    return [];
  }

  const membershipResponse = await client
    .from("organization_users")
    .select("organization_id, user_id, role, is_active, created_at, updated_at")
    .eq("user_id", resolvedUserId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (membershipResponse.error) {
    throw new Error(
      `Failed to load organization memberships: ${membershipResponse.error.message}`
    );
  }

  const membershipRows = (membershipResponse.data ?? []) as MembershipRow[];
  const organizationIds = Array.from(
    new Set(membershipRows.map((row) => row.organization_id))
  );

  if (!organizationIds.length) {
    return [];
  }

  const organizationsResponse = await client
    .from("organizations")
    .select("id, name, slug, is_active, created_at, updated_at")
    .in("id", organizationIds)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (organizationsResponse.error) {
    throw new Error(
      `Failed to load organizations: ${organizationsResponse.error.message}`
    );
  }

  const organizations = new Map(
    ((organizationsResponse.data ?? []) as OrganizationRow[]).map((row) => [
      row.id,
      mapOrganization(row),
    ])
  );

  return membershipRows
    .map((row) => {
      const organization = organizations.get(row.organization_id);
      if (!organization) {
        return null;
      }

      return {
        organizationId: row.organization_id,
        userId: row.user_id,
        role: row.role,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        organization,
      } satisfies OrganizationMembership;
    })
    .filter((membership): membership is OrganizationMembership => !!membership)
    .sort((a, b) => a.organization.name.localeCompare(b.organization.name));
}

export async function getCurrentOrganizationMembership(
  supabase: unknown,
  options?: {
    userId?: string | null;
    preferredOrganizationId?: string | null;
  }
): Promise<OrganizationMembership | null> {
  const memberships = await getOrganizationMembershipsForUser(
    supabase,
    options?.userId
  );

  if (!memberships.length) {
    return null;
  }

  const preferredOrganizationId =
    options?.preferredOrganizationId ?? (await getStoredCurrentOrganizationId());

  if (preferredOrganizationId) {
    const preferredMembership =
      memberships.find(
        (membership) => membership.organizationId === preferredOrganizationId
      ) ?? null;

    if (preferredMembership) {
      return preferredMembership;
    }
  }

  if (memberships.length === 1) {
    return memberships[0];
  }

  return memberships[0];
}

export async function getCurrentOrganization(
  supabase: unknown,
  options?: {
    userId?: string | null;
    preferredOrganizationId?: string | null;
  }
): Promise<Organization | null> {
  const membership = await getCurrentOrganizationMembership(supabase, options);
  return membership?.organization ?? null;
}

export async function getCurrentOrganizationId(
  supabase: unknown,
  options?: {
    userId?: string | null;
    preferredOrganizationId?: string | null;
  }
): Promise<string | null> {
  const membership = await getCurrentOrganizationMembership(supabase, options);
  return membership?.organizationId ?? null;
}

export async function getCurrentOrganizationRole(
  supabase: unknown,
  options?: {
    userId?: string | null;
    preferredOrganizationId?: string | null;
  }
): Promise<UserRole | null> {
  const membership = await getCurrentOrganizationMembership(supabase, options);
  return membership?.role ?? null;
}
