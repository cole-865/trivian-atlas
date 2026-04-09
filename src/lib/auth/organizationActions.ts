"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import {
  clearStoredCurrentOrganizationId,
  setStoredCurrentOrganizationId,
} from "@/lib/auth/organizationContext";
import { planOrganizationSwitch } from "@/lib/auth/actionPlans";
import { getAuthContext } from "@/lib/auth/userRole";
import { getSwitchableOrganizations } from "@/lib/auth/organizationManagement";

export async function setCurrentOrganizationAction(formData: FormData) {
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);
  const switchableOrganizations = await getSwitchableOrganizations(authContext);

  const plan = planOrganizationSwitch({
    requestedOrganizationId: organizationId,
    switchableOrganizationIds: switchableOrganizations.map((organization) => organization.id),
  });

  if (plan.cookieAction === "clear") {
    await clearStoredCurrentOrganizationId();
    for (const path of plan.revalidatePaths) {
      revalidatePath(path, path === "/" ? "layout" : undefined);
    }
    return;
  }

  if (plan.cookieAction === "noop" || !plan.organizationId) {
    return;
  }

  await setStoredCurrentOrganizationId(plan.organizationId);
  for (const path of plan.revalidatePaths) {
    revalidatePath(path, path === "/" ? "layout" : undefined);
  }
}
