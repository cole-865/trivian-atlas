import type { User } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/auth/permissions";

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

export async function getCurrentUserProfile(
  supabase: SupabaseLike
): Promise<UserProfile | null> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw new Error(`Failed to load current user: ${authError.message}`);
  }

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, email, full_name, role, is_active, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load user profile: ${error.message}`);
  }

  return mapUserProfile(data);
}

export async function getCurrentUserRole(
  supabase: SupabaseLike
): Promise<UserRole | null> {
  const profile = await getCurrentUserProfile(supabase);

  if (profile) {
    return profile.isActive ? profile.role : null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Transitional fallback only while existing users are being backfilled into
  // public.user_profiles. Remove this once every active staff user has a row.
  return getRoleFromMetadata(user);
}
