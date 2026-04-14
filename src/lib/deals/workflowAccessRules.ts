import type { DealStep, StepAccessResult } from "./canAccessStep";

export type WorkflowAccessSettings = {
  stepEnforcementEnabled: boolean;
  requireCreditBureauBeforeSubmit: boolean;
  requireCustomerBeforeIncome: boolean;
  requireUnderwritingDecisionBeforeVehicle: boolean;
  allowAdminBypass: boolean;
  lockCompletedStepsAfterSubmit: boolean;
  requireManagerApprovalToReopenSubmittedDeals: boolean;
};

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

function hasText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export function evaluateWorkflowStepAccessRules(args: {
  settings: WorkflowAccessSettings;
  canBypassStepEnforcement: boolean;
  step: DealStep;
  deal: DealLike;
  underwriting?: UnderwritingLike | null;
}) {
  if (!args.settings.stepEnforcementEnabled) {
    return {
      allowed: true,
      reason: "Step enforcement is disabled.",
    } satisfies StepAccessResult;
  }

  if (
    args.settings.allowAdminBypass &&
    args.canBypassStepEnforcement
  ) {
    return {
      allowed: true,
      reason: "Admin workflow bypass is enabled for this account.",
    } satisfies StepAccessResult;
  }

  const hasVehicle = hasText(args.deal.selected_vehicle_id);
  const hasDecision = hasText(args.underwriting?.decision);
  const hasSubmitted =
    args.deal.submit_status === "submitted" || hasText(args.deal.submitted_at);

  if (
    args.settings.lockCompletedStepsAfterSubmit &&
    hasSubmitted &&
    (args.step === "customer" ||
      args.step === "income" ||
      args.step === "vehicle" ||
      args.step === "deal")
  ) {
    return {
      allowed: false,
      redirectTo: "submit",
      reason: "Submitted deals are locked for earlier workflow steps.",
    } satisfies StepAccessResult;
  }

  switch (args.step) {
    case "customer":
    case "income":
      return { allowed: true } satisfies StepAccessResult;

    case "vehicle":
      if (args.settings.requireUnderwritingDecisionBeforeVehicle && !hasDecision) {
        return {
          allowed: false,
          redirectTo: "income",
          reason: "A real underwriting decision is required before vehicle selection.",
        } satisfies StepAccessResult;
      }
      return { allowed: true } satisfies StepAccessResult;

    case "deal":
      if (!hasVehicle) {
        return {
          allowed: false,
          redirectTo: "vehicle",
          reason: "Select a vehicle before opening the deal structure step.",
        } satisfies StepAccessResult;
      }
      return { allowed: true } satisfies StepAccessResult;

    case "submit":
      if (!hasVehicle) {
        return {
          allowed: false,
          redirectTo: "vehicle",
          reason: "Select a vehicle before opening the submit step.",
        } satisfies StepAccessResult;
      }
      return { allowed: true } satisfies StepAccessResult;

    case "fund":
      if (!hasSubmitted) {
        return {
          allowed: false,
          redirectTo: "submit",
          reason: "Complete the submit step before opening funding.",
        } satisfies StepAccessResult;
      }

      if (!hasDecision) {
        return {
          allowed: false,
          redirectTo: "submit",
          reason: "A real underwriting decision is required before funding.",
        } satisfies StepAccessResult;
      }
      return { allowed: true } satisfies StepAccessResult;

    default:
      return { allowed: true } satisfies StepAccessResult;
  }
}
