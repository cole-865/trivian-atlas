"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import {
  clearStoredCurrentOrganizationId,
  getOrganizationMembershipsForUser,
  setStoredCurrentOrganizationId,
} from "@/lib/auth/organizationContext";

export async function setCurrentOrganizationAction(formData: FormData) {
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const supabase = await createClient();

  const memberships = await getOrganizationMembershipsForUser(supabase);

  if (!organizationId) {
    await clearStoredCurrentOrganizationId();
    revalidatePath("/", "layout");
    revalidatePath("/settings");
    return;
  }

  const allowedMembership = memberships.find(
    (membership) => membership.organizationId === organizationId
  );

  if (!allowedMembership) {
    return;
  }

  await setStoredCurrentOrganizationId(organizationId);
  revalidatePath("/", "layout");
  revalidatePath("/settings");
}
