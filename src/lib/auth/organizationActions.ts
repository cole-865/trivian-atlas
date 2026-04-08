"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import {
  clearStoredCurrentOrganizationId,
  setStoredCurrentOrganizationId,
} from "@/lib/auth/organizationContext";
import { getAuthContext } from "@/lib/auth/userRole";
import { getSwitchableOrganizations } from "@/lib/auth/organizationManagement";

export async function setCurrentOrganizationAction(formData: FormData) {
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);
  const switchableOrganizations = await getSwitchableOrganizations(authContext);

  if (!organizationId) {
    await clearStoredCurrentOrganizationId();
    revalidatePath("/", "layout");
    revalidatePath("/settings");
    revalidatePath("/dev-tools");
    return;
  }

  const allowedOrganization = switchableOrganizations.find(
    (organization) => organization.id === organizationId
  );

  if (!allowedOrganization) {
    return;
  }

  await setStoredCurrentOrganizationId(organizationId);
  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath("/dev-tools");
}
