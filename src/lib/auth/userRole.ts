import type { User } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/auth/permissions";
import { getImpersonatedUserId } from "@/lib/auth/impersonation";

const USER_ROLES = ["sales", "management", "admin", "dev"] as const;

type SupabaseLike = {
  auth: {
    getUser: () => Promise<{
      data: { user: User | null };
      error?: { message: string } | null;
    }>;
  };
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{
          data: UserProfileRow | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

type UserProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type UserProfile = {
  id: string;
  email: string | null;
  fullName: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuthContext = {
  realUser: User | null;
  realProfile: UserProfile | null;
  realRole: UserRole | null;
  effectiveProfile: UserProfile | null;
  effectiveRole: UserRole | null;
  isImpersonating: boolean;
  impersonatedProfile: UserProfile | null;
  impersonatedUserId: string | null;
};

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

function mapUserProfile(row: UserProfileRow | null): UserProfile | null {
  if (!row || !isUserRole(row.role)) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRoleFromMetadata(user: User | null | undefined): UserRole | null {
  const appRole = user?.app_metadata?.role;
  if (isUserRole(appRole)) {
    return appRole;
  }

  const metadataRole = user?.user_metadata?.role;
  if (isUserRole(metadataRole)) {
    return metadataRole;
  }

  return null;
}

async function getAuthenticatedUser(supabase: SupabaseLike): Promise<User | null> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw new Error(`Failed to load current user: ${authError.message}`);
  }

  return user;
}

async function getUserProfileById(
  supabase: SupabaseLike,
  userId: string
): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, email, full_name, role, is_active, created_at, updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load user profile: ${error.message}`);
  }

  return mapUserProfile(data);
}

export async function getRealUserProfile(
  supabase: unknown
): Promise<UserProfile | null> {
  const client = supabase as SupabaseLike;
  const user = await getAuthenticatedUser(client);

  if (!user) {
    return null;
  }

  return getUserProfileById(client, user.id);
}

export async function getRealUserRole(
  supabase: unknown
): Promise<UserRole | null> {
  const client = supabase as SupabaseLike;
  const user = await getAuthenticatedUser(client);

  if (!user) {
    return null;
  }

  const profile = await getUserProfileById(client, user.id);

  if (profile) {
    return profile.isActive ? profile.role : null;
  }

  // Transitional fallback only while existing users are being backfilled into
  // public.user_profiles. Remove this once every active staff user has a row.
  return getRoleFromMetadata(user);
}

export async function getAuthContext(
  supabase: unknown
): Promise<AuthContext> {
  const client = supabase as SupabaseLike;
  const realUser = await getAuthenticatedUser(client);

  if (!realUser) {
    return {
      realUser: null,
      realProfile: null,
      realRole: null,
      effectiveProfile: null,
      effectiveRole: null,
      isImpersonating: false,
      impersonatedProfile: null,
      impersonatedUserId: null,
    };
  }

  const realProfile = await getUserProfileById(client, realUser.id);
  const realRole = realProfile
    ? realProfile.isActive
      ? realProfile.role
      : null
    : getRoleFromMetadata(realUser);

  const requestedImpersonatedUserId = await getImpersonatedUserId();

  if (
    realRole !== "dev" ||
    !requestedImpersonatedUserId ||
    requestedImpersonatedUserId === realUser.id
  ) {
    return {
      realUser,
      realProfile,
      realRole,
      effectiveProfile: realProfile,
      effectiveRole: realRole,
      isImpersonating: false,
      impersonatedProfile: null,
      impersonatedUserId: null,
    };
  }

  const impersonatedProfile = await getUserProfileById(
    client,
    requestedImpersonatedUserId
  );

  if (!impersonatedProfile?.isActive) {
    return {
      realUser,
      realProfile,
      realRole,
      effectiveProfile: realProfile,
      effectiveRole: realRole,
      isImpersonating: false,
      impersonatedProfile: null,
      impersonatedUserId: null,
    };
  }

  return {
    realUser,
    realProfile,
    realRole,
    effectiveProfile: impersonatedProfile,
    effectiveRole: impersonatedProfile.role,
    isImpersonating: true,
    impersonatedProfile,
    impersonatedUserId: impersonatedProfile.id,
  };
}

export async function getEffectiveUserProfile(
  supabase: unknown
): Promise<UserProfile | null> {
  const authContext = await getAuthContext(supabase);
  return authContext.effectiveProfile;
}

export async function getEffectiveUserRole(
  supabase: unknown
): Promise<UserRole | null> {
  const authContext = await getAuthContext(supabase);
  return authContext.effectiveRole;
}

export async function getCurrentUserProfile(
  supabase: unknown
): Promise<UserProfile | null> {
  return getEffectiveUserProfile(supabase);
}

export async function getCurrentUserRole(
  supabase: unknown
): Promise<UserRole | null> {
  return getEffectiveUserRole(supabase);
}
