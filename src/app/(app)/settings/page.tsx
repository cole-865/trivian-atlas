import { revalidatePath } from "next/cache";
import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentUserRole } from "@/lib/auth/userRole";
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
  const role = await getCurrentUserRole(supabase);
  const showStepEnforcementToggle = canManageStepEnforcement(role);
  const stepEnforcementEnabled = showStepEnforcementToggle
    ? await getStepEnforcementEnabled(supabase)
    : true;

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="text-xl font-semibold">Settings</div>
      <div className="mt-2 text-sm text-muted-foreground">
        Workflow and app defaults.
      </div>

      {showStepEnforcementToggle ? (
        <form action={updateStepEnforcementSetting} className="mt-6">
          <div className="rounded-2xl border border-gray-200 p-4">
            <div className="text-sm font-medium">Workflow step enforcement</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Keep workflow step gating enabled for normal app behavior.
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
                  When disabled, debug workflows can bypass step enforcement.
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
