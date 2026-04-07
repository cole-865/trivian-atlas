import { revalidatePath } from "next/cache";
import { hasPermission } from "@/lib/auth/permissions";
import { setCurrentOrganizationAction } from "@/lib/auth/organizationActions";
import { getAuthContext, getCurrentUserRole } from "@/lib/auth/userRole";
import {
  getStepEnforcementEnabled,
  setStepEnforcementEnabled,
} from "@/lib/settings/appSettings";
import { createClient } from "@/utils/supabase/server";

function canManageStepEnforcement(role: Awaited<ReturnType<typeof getCurrentUserRole>>) {
  return !!role && (
    hasPermission(role, "edit_settings") ||
    hasPermission(role, "access_debug_tools")
  );
}

async function updateStepEnforcementSetting(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const role = await getCurrentUserRole(supabase);

  if (!canManageStepEnforcement(role)) {
    return;
  }

  const enabled = formData.get("step_enforcement_enabled") === "on";
  const { error } = await setStepEnforcementEnabled(supabase, enabled);

  if (error) {
    throw new Error(`Failed to save step enforcement setting: ${error.message}`);
  }

  revalidatePath("/settings");
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);
  const role = await getCurrentUserRole(supabase);
  const showStepEnforcementToggle = canManageStepEnforcement(role);
  const stepEnforcementEnabled = showStepEnforcementToggle
    ? await getStepEnforcementEnabled(supabase)
    : true;
  const showOrganizationSelector =
    authContext.availableOrganizationMemberships.length > 1;

  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-xl font-semibold">Settings</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Workflow and organization defaults.
        </div>

        <div className="mt-6 rounded-2xl border border-gray-200 p-4">
          <div className="text-sm font-medium">Current organization</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Authorization and settings now resolve against the active dealership organization.
          </div>

          <div className="mt-4 rounded-xl border bg-gray-50 px-4 py-3 text-sm">
            <div className="font-medium">
              {authContext.currentOrganization?.name ?? "No organization selected"}
            </div>
            <div className="mt-1 text-muted-foreground">
              {authContext.currentOrganization?.slug
                ? `Slug: ${authContext.currentOrganization.slug}`
                : "The current user does not have an active organization membership yet."}
            </div>
          </div>

          {showOrganizationSelector ? (
            <form action={setCurrentOrganizationAction} className="mt-4 grid gap-3 md:max-w-xl">
              <label className="grid gap-2">
                <span className="text-sm font-medium">Switch organization</span>
                <select
                  name="organization_id"
                  defaultValue={authContext.currentOrganizationId ?? ""}
                  className="rounded-xl border px-3 py-2 text-sm"
                >
                  {authContext.availableOrganizationMemberships.map((membership) => (
                    <option key={membership.organizationId} value={membership.organizationId}>
                      {membership.organization.name} ({membership.role})
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <button
                  type="submit"
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Use organization
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>

      {showStepEnforcementToggle ? (
        <form action={updateStepEnforcementSetting}>
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="text-sm font-medium">Workflow step enforcement</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Keep workflow step gating enabled for the current organization.
            </div>

            <label className="mt-4 flex items-start gap-3">
              <input
                type="checkbox"
                name="step_enforcement_enabled"
                defaultChecked={stepEnforcementEnabled}
                className="mt-1 h-4 w-4 rounded border-gray-300"
              />
              <div>
                <div className="text-sm font-medium">
                  Enable step enforcement
                </div>
                <div className="text-sm text-muted-foreground">
                  When disabled, debug workflows can bypass step enforcement inside this organization.
                </div>
              </div>
            </label>

            <div className="mt-4">
              <button
                type="submit"
                className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:opacity-90"
              >
                Save settings
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
