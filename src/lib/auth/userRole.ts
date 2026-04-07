import type { User } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/auth/permissions";

const USER_ROLES = ["sales", "management", "admin", "dev"] as const;

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

export function getUserRole(user: User | null | undefined): UserRole | null {
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
