"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import {
  ORG_MANAGED_ROLES,
  acceptOrganizationInvite,
  canCreateOrganizations,
  canManageCurrentOrganization,
  createOrganization,
  createOrganizationInvite,
  resendOrganizationInvite,
  revokeOrganizationInvite,
  setOrganizationActiveState,
  slugifyOrganizationName,
  updateOrganizationMembership,
} from "@/lib/auth/organizationManagement";
import { getAuthContext } from "@/lib/auth/userRole";

const inviteFormSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required."),
  email: z.email("A valid email is required."),
  role: z.enum(ORG_MANAGED_ROLES),
});

const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Account name is required."),
  slug: z.string().trim().min(1, "Account slug is required."),
  initialAdminName: z.string().trim().min(1, "Initial account admin name is required."),
  initialAdminEmail: z.email("A valid initial account admin email is required."),
});

const updateMembershipSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ORG_MANAGED_ROLES).optional(),
  isActive: z.boolean().optional(),
});

function toBoolean(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return false;
  }

  return value === "true" || value === "1" || value === "on";
}

function redirectWithMessage(
  path: string,
  key: "notice" | "error",
  message: string
): never {
  const params = new URLSearchParams();
  params.set(key, message);
  redirect(`${path}?${params.toString()}`);
}

export async function createOrganizationAction(formData: FormData) {
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);

  if (!canCreateOrganizations(authContext) || !authContext.realUser) {
    redirectWithMessage("/dev-tools", "error", "Only platform dev can create accounts.");
  }

  const parsed = createOrganizationSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    slug:
      String(formData.get("slug") ?? "").trim() ||
      slugifyOrganizationName(String(formData.get("name") ?? "")),
    initialAdminName: String(formData.get("initial_admin_name") ?? ""),
    initialAdminEmail: String(formData.get("initial_admin_email") ?? ""),
  });

  if (!parsed.success) {
    redirectWithMessage("/dev-tools", "error", parsed.error.issues[0]?.message ?? "Invalid account form.");
  }

  if (!authContext.realUser) {
    redirectWithMessage("/dev-tools", "error", "Missing platform user context.");
  }

  await createOrganization({
    ...parsed.data,
    createdByUserId: authContext.realUser.id,
  });

  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath("/dev-tools");
  redirectWithMessage("/dev-tools", "notice", "Account created and switched.");
}

export async function setOrganizationActiveStateAction(formData: FormData) {
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const isActive = toBoolean(formData.get("is_active"));
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);

  if (!canCreateOrganizations(authContext) || !organizationId) {
    redirectWithMessage("/dev-tools", "error", "Only platform dev can manage account state.");
  }

  await setOrganizationActiveState({
    organizationId,
    isActive,
  });

  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath("/dev-tools");
  redirectWithMessage(
    "/dev-tools",
    "notice",
    isActive ? "Account reactivated." : "Account deactivated."
  );
}

export async function createOrganizationInviteAction(formData: FormData) {
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);

  if (!canManageCurrentOrganization(authContext) || !authContext.currentOrganizationId) {
    redirectWithMessage("/settings", "error", "You cannot invite users into this account.");
  }

  const parsed = inviteFormSchema.safeParse({
    fullName: String(formData.get("full_name") ?? ""),
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? ""),
  });

  if (!parsed.success) {
    redirectWithMessage(
      "/settings",
      "error",
      parsed.error.issues[0]?.message ?? "Invalid invite form."
    );
  }

  if (!authContext.realUser) {
    redirectWithMessage("/settings", "error", "Missing inviter context.");
  }

  const invite = await createOrganizationInvite({
    organizationId: authContext.currentOrganizationId,
    invitedByUserId: authContext.realUser.id,
    ...parsed.data,
  });

  revalidatePath("/settings");
  redirectWithMessage("/settings", "notice", `Invitation created. Share this link: ${invite.acceptUrl}`);
}

export async function resendOrganizationInviteAction(formData: FormData) {
  const inviteId = String(formData.get("invite_id") ?? "").trim();
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);

  if (!canManageCurrentOrganization(authContext) || !inviteId) {
    redirectWithMessage("/settings", "error", "You cannot resend this invitation.");
  }

  if (!authContext.realUser || !authContext.currentOrganizationId) {
    redirectWithMessage("/settings", "error", "Missing account management context.");
  }

  const invite = await resendOrganizationInvite(
    inviteId,
    authContext.currentOrganizationId,
    authContext.realUser.id
  );
  revalidatePath("/settings");
  redirectWithMessage("/settings", "notice", `Invitation resent. Share this link: ${invite.acceptUrl}`);
}

export async function revokeOrganizationInviteAction(formData: FormData) {
  const inviteId = String(formData.get("invite_id") ?? "").trim();
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);

  if (!canManageCurrentOrganization(authContext) || !inviteId) {
    redirectWithMessage("/settings", "error", "You cannot revoke this invitation.");
  }

  if (!authContext.currentOrganizationId) {
    redirectWithMessage("/settings", "error", "Missing account management context.");
  }

  await revokeOrganizationInvite(inviteId, authContext.currentOrganizationId);
  revalidatePath("/settings");
  redirectWithMessage("/settings", "notice", "Invitation revoked.");
}

export async function updateOrganizationMembershipAction(formData: FormData) {
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);

  if (!canManageCurrentOrganization(authContext) || !authContext.currentOrganizationId) {
    redirectWithMessage("/settings", "error", "You cannot update users in this account.");
  }

  const rawRole = String(formData.get("role") ?? "").trim();
  const parsed = updateMembershipSchema.safeParse({
    userId: String(formData.get("user_id") ?? ""),
    role: rawRole ? rawRole : undefined,
    isActive:
      formData.get("is_active") === null ? undefined : toBoolean(formData.get("is_active")),
  });

  if (!parsed.success) {
    redirectWithMessage("/settings", "error", parsed.error.issues[0]?.message ?? "Invalid membership update.");
  }

  await updateOrganizationMembership({
    organizationId: authContext.currentOrganizationId,
    ...parsed.data,
  });

  revalidatePath("/settings");
  redirectWithMessage("/settings", "notice", "Account user updated.");
}

export async function acceptOrganizationInviteAction(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user || !token) {
    redirect(`/login?redirect=${encodeURIComponent(`/invite/accept?token=${token}`)}`);
  }

  try {
    await acceptOrganizationInvite({
      token,
      userId: data.user.id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to accept account invitation.";
    redirect(`/invite/accept?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/", "layout");
  revalidatePath("/settings");
  redirect("/home");
}
