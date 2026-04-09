"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import {
  clearImpersonatedUserId,
  setImpersonatedUserId,
} from "@/lib/auth/impersonation";
import { planImpersonationChange } from "@/lib/auth/actionPlans";
import { getCurrentOrganizationMembership } from "@/lib/auth/organizationContext";
import { getAuthContext } from "@/lib/auth/userRole";

type StaffProfileRow = {
  id: string;
  is_active: boolean;
};

export async function startImpersonationAction(formData: FormData) {
  const targetUserId = String(formData.get("impersonated_user_id") ?? "").trim();
  if (!targetUserId) {
    return;
  }

  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);

  if (
    authContext.realRole !== "dev" ||
    !authContext.realUser ||
    !authContext.currentOrganizationId
  ) {
    return;
  }

  if (targetUserId === authContext.realUser.id) {
    await clearImpersonatedUserId();
    revalidatePath("/", "layout");
    revalidatePath("/settings");
    return;
  }

  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, is_active")
    .eq("id", targetUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load impersonation target: ${error.message}`);
  }

  const target = data as StaffProfileRow | null;
  if (!target?.id) {
    return;
  }

  const targetMembership = await getCurrentOrganizationMembership(supabase, {
    userId: target.id,
    preferredOrganizationId: authContext.currentOrganizationId,
  });

  const plan = planImpersonationChange({
    realRole: authContext.realRole,
    realUserId: authContext.realUser.id,
    currentOrganizationId: authContext.currentOrganizationId,
    targetUserId: target.id,
    targetUserActive: target.is_active,
    targetMembershipOrganizationId: targetMembership?.organizationId ?? null,
  });

  if (plan.cookieAction === "noop") {
    return;
  }

  if (plan.cookieAction === "clear") {
    await clearImpersonatedUserId();
    for (const path of plan.revalidatePaths) {
      revalidatePath(path, path === "/" ? "layout" : undefined);
    }
    return;
  }

  if (!plan.impersonatedUserId) {
    return;
  }

  await setImpersonatedUserId(plan.impersonatedUserId);
  for (const path of plan.revalidatePaths) {
    revalidatePath(path, path === "/" ? "layout" : undefined);
  }
}

export async function stopImpersonationAction() {
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);

  if (authContext.realRole !== "dev") {
    return;
  }

  await clearImpersonatedUserId();
  revalidatePath("/", "layout");
  revalidatePath("/settings");
}
