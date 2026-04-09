"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import {
  clearStoredCurrentOrganizationId,
  setStoredCurrentOrganizationId,
} from "@/lib/auth/organizationContext";
import { getOrganizationSwitchDecision } from "@/lib/auth/accessRules";
import { getAuthContext } from "@/lib/auth/userRole";
import { getSwitchableOrganizations } from "@/lib/auth/organizationManagement";

export async function setCurrentOrganizationAction(formData: FormData) {
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);
  const switchableOrganizations = await getSwitchableOrganizations(authContext);

  const decision = getOrganizationSwitchDecision({
    requestedOrganizationId: organizationId,
    switchableOrganizationIds: switchableOrganizations.map((organization) => organization.id),
  });

  if (decision === "clear") {
    await clearStoredCurrentOrganizationId();
    revalidatePath("/", "layout");
    revalidatePath("/settings");
    revalidatePath("/dev-tools");
    return;
  }

  if (decision === "reject") {
    return;
  }

  await setStoredCurrentOrganizationId(organizationId);
  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath("/dev-tools");
}
