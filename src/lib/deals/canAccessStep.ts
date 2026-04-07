import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentUserRole } from "@/lib/auth/userRole";
import { getStepEnforcementEnabled } from "@/lib/settings/appSettings";

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

function hasText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export async function canAccessStep({
  supabase,
  step,
  deal,
  underwriting,
}: {
  supabase: unknown;
  step: DealStep;
  deal: DealLike;
  underwriting?: UnderwritingLike | null;
}): Promise<StepAccessResult> {
  const role = await getCurrentUserRole(
    supabase as Parameters<typeof getCurrentUserRole>[0]
  );
  const enforcementEnabled = await getStepEnforcementEnabled(
    supabase as Parameters<typeof getStepEnforcementEnabled>[0]
  );

  if (!enforcementEnabled) {
    return {
      allowed: true,
      reason: "Step enforcement is disabled.",
    };
  }

  if (role && hasPermission(role, "access_debug_tools")) {
    return {
      allowed: true,
      reason: "Debug access bypass is enabled for this user.",
    };
  }

  const hasVehicle = hasText(deal.selected_vehicle_id);
  const hasDecision = hasText(underwriting?.decision);
  const hasSubmitted = deal.submit_status === "submitted" || hasText(deal.submitted_at);

  switch (step) {
    case "customer":
      return { allowed: true };

    case "income":
      return { allowed: true };

    case "vehicle":
      if (!hasDecision) {
        return {
          allowed: false,
          redirectTo: "income",
          reason: "A real underwriting decision is required before vehicle selection.",
        };
      }
      return { allowed: true };

    case "deal":
      if (!hasVehicle) {
        return {
          allowed: false,
          redirectTo: "vehicle",
          reason: "Select a vehicle before opening the deal structure step.",
        };
      }
      return { allowed: true };

    case "submit":
      if (!hasVehicle) {
        return {
          allowed: false,
          redirectTo: "vehicle",
          reason: "Select a vehicle before opening the submit step.",
        };
      }
      return { allowed: true };

    case "fund":
      if (!hasSubmitted) {
        return {
          allowed: false,
          redirectTo: "submit",
          reason: "Complete the submit step before opening funding.",
        };
      }

      if (!hasDecision) {
        return {
          allowed: false,
          redirectTo: "submit",
          reason: "A real underwriting decision is required before funding.",
        };
      }
      return { allowed: true };

    default:
      return { allowed: true };
  }
}
