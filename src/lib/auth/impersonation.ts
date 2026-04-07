import { cookies } from "next/headers";

export const IMPERSONATION_COOKIE_NAME = "atlas_impersonated_user_id";

function impersonationCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  };
}

export async function getImpersonatedUserId() {
  const cookieStore = await cookies();
  return cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value ?? null;
}

export async function setImpersonatedUserId(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(
    IMPERSONATION_COOKIE_NAME,
    userId,
    impersonationCookieOptions()
  );
}

export async function clearImpersonatedUserId() {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_COOKIE_NAME);
}
