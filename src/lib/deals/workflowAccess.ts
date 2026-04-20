import { getAuthContext } from "@/lib/auth/userRole";
import { canPlatformDevManage } from "@/lib/auth/dealershipPermissions";
import { getWorkflowSettings } from "@/lib/settings/appSettings";
import type { DealStep, StepAccessResult } from "@/lib/deals/canAccessStep";
import {
  evaluateWorkflowStepAccessRules as evaluateWorkflowStepAccessRulesBase,
  type WorkflowAccessSettings,
} from "@/lib/deals/workflowAccessRules";

type DealLike = {
  status?: string | null;
  household_income?: boolean | number | null;
  selected_vehicle_id?: string | null;
  submit_status?: string | null;
  submitted_at?: string | null;
};

type UnderwritingLike = {
  decision?: string | null;
};

export function evaluateWorkflowStepAccessRules(args: {
  settings: WorkflowAccessSettings;
  canBypassStepEnforcement: boolean;
  step: DealStep;
  deal: DealLike;
  underwriting?: UnderwritingLike | null;
}) {
  return evaluateWorkflowStepAccessRulesBase(args);
}

export async function evaluateWorkflowStepAccess({
  supabase,
  step,
  deal,
  underwriting,
}: {
  supabase: Parameters<typeof getWorkflowSettings>[0];
  step: DealStep;
  deal: DealLike;
  underwriting?: UnderwritingLike | null;
}): Promise<StepAccessResult> {
  const authContext = await getAuthContext(supabase);
  const settings = await getWorkflowSettings(supabase);

  return evaluateWorkflowStepAccessRules({
    settings,
    canBypassStepEnforcement:
      canPlatformDevManage(authContext) ||
      authContext.effectiveOrganizationRole === "admin",
    step,
    deal,
    underwriting,
  });
}

export async function getSubmitRequirementSettings(
  supabase: Parameters<typeof getWorkflowSettings>[0]
) {
  const settings = await getWorkflowSettings(supabase);
  return {
    requireCreditBureauBeforeSubmit: settings.requireCreditBureauBeforeSubmit,
  };
}
