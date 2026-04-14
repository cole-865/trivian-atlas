import { evaluateWorkflowStepAccess } from "@/lib/deals/workflowAccess";

export type DealStep =
  | "customer"
  | "income"
  | "vehicle"
  | "deal"
  | "submit"
  | "fund";

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

export type StepAccessResult =
  | {
      allowed: true;
      reason?: string;
    }
  | {
      allowed: false;
      redirectTo?: DealStep;
      reason?: string;
    };

export async function canAccessStep({
  supabase,
  step,
  deal,
  underwriting,
}: {
  supabase: Parameters<typeof evaluateWorkflowStepAccess>[0]["supabase"];
  step: DealStep;
  deal: DealLike;
  underwriting?: UnderwritingLike | null;
}): Promise<StepAccessResult> {
  return evaluateWorkflowStepAccess({ supabase, step, deal, underwriting });
}
