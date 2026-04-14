import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentOrganizationId } from "@/lib/auth/organizationContext";
import type { Database, Json } from "@/lib/supabase/database.generated";

const STEP_ENFORCEMENT_SETTING_KEY = "step_enforcement_enabled";
const WORKFLOW_SETTINGS_KEY = "workflow";

export type WorkflowSettings = {
  stepEnforcementEnabled: boolean;
  requireCreditBureauBeforeSubmit: boolean;
  requireCustomerBeforeIncome: boolean;
  requireUnderwritingDecisionBeforeVehicle: boolean;
  allowAdminBypass: boolean;
  lockCompletedStepsAfterSubmit: boolean;
  requireManagerApprovalToReopenSubmittedDeals: boolean;
};

export const DEFAULT_WORKFLOW_SETTINGS: WorkflowSettings = {
  stepEnforcementEnabled: true,
  requireCreditBureauBeforeSubmit: true,
  requireCustomerBeforeIncome: false,
  requireUnderwritingDecisionBeforeVehicle: true,
  allowAdminBypass: true,
  lockCompletedStepsAfterSubmit: false,
  requireManagerApprovalToReopenSubmittedDeals: false,
};

type TypedSupabaseClient = SupabaseClient<Database>;

export async function getStepEnforcementEnabled(supabase: TypedSupabaseClient) {
  return (await getWorkflowSettings(supabase)).stepEnforcementEnabled;
}

function booleanFromRecord(
  source: Record<string, unknown>,
  key: keyof WorkflowSettings,
  fallback: boolean
) {
  return typeof source[key] === "boolean" ? source[key] : fallback;
}

function renamedBooleanFromRecord(
  source: Record<string, unknown>,
  key: keyof WorkflowSettings,
  legacyKey: string,
  fallback: boolean
) {
  if (typeof source[key] === "boolean") {
    return source[key];
  }

  return typeof source[legacyKey] === "boolean" ? source[legacyKey] : fallback;
}

function mapWorkflowSettings(value: unknown): WorkflowSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_WORKFLOW_SETTINGS;
  }

  const record = value as Record<string, unknown>;

  return {
    stepEnforcementEnabled: booleanFromRecord(
      record,
      "stepEnforcementEnabled",
      DEFAULT_WORKFLOW_SETTINGS.stepEnforcementEnabled
    ),
    requireCreditBureauBeforeSubmit: booleanFromRecord(
      record,
      "requireCreditBureauBeforeSubmit",
      DEFAULT_WORKFLOW_SETTINGS.requireCreditBureauBeforeSubmit
    ),
    requireCustomerBeforeIncome: booleanFromRecord(
      record,
      "requireCustomerBeforeIncome",
      DEFAULT_WORKFLOW_SETTINGS.requireCustomerBeforeIncome
    ),
    requireUnderwritingDecisionBeforeVehicle: renamedBooleanFromRecord(
      record,
      "requireUnderwritingDecisionBeforeVehicle",
      "requireIncomeBeforeVehicle",
      DEFAULT_WORKFLOW_SETTINGS.requireUnderwritingDecisionBeforeVehicle
    ),
    allowAdminBypass: booleanFromRecord(
      record,
      "allowAdminBypass",
      DEFAULT_WORKFLOW_SETTINGS.allowAdminBypass
    ),
    lockCompletedStepsAfterSubmit: booleanFromRecord(
      record,
      "lockCompletedStepsAfterSubmit",
      DEFAULT_WORKFLOW_SETTINGS.lockCompletedStepsAfterSubmit
    ),
    requireManagerApprovalToReopenSubmittedDeals: booleanFromRecord(
      record,
      "requireManagerApprovalToReopenSubmittedDeals",
      DEFAULT_WORKFLOW_SETTINGS.requireManagerApprovalToReopenSubmittedDeals
    ),
  };
}

export async function getWorkflowSettings(supabase: TypedSupabaseClient) {
  const client = supabase;
  const organizationId = await getCurrentOrganizationId(client);

  if (organizationId) {
    const workflowResponse = await client
      .from("organization_settings")
      .select("value_json")
      .eq("organization_id", organizationId)
      .eq("key", WORKFLOW_SETTINGS_KEY)
      .maybeSingle();

    if (workflowResponse.error) {
      throw new Error(
        `Failed to load organization workflow settings: ${workflowResponse.error.message}`
      );
    }

    if (workflowResponse.data?.value_json) {
      return mapWorkflowSettings(workflowResponse.data.value_json);
    }

    const { data, error } = await client
      .from("organization_settings")
      .select("value_json")
      .eq("organization_id", organizationId)
      .eq("key", STEP_ENFORCEMENT_SETTING_KEY)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load organization setting: ${error.message}`);
    }

    if (typeof data?.value_json === "boolean") {
      return {
        ...DEFAULT_WORKFLOW_SETTINGS,
        stepEnforcementEnabled: data.value_json,
      };
    }
  }

  // Transitional fallback while the existing dealership is being migrated from
  // global app_settings into organization_settings.
  const { data, error } = await client
    .from("app_settings")
    .select("value_json")
    .eq("key", STEP_ENFORCEMENT_SETTING_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load app setting: ${error.message}`);
  }

  return typeof data?.value_json === "boolean"
    ? {
        ...DEFAULT_WORKFLOW_SETTINGS,
        stepEnforcementEnabled: data.value_json,
      }
    : DEFAULT_WORKFLOW_SETTINGS;
}

export async function setStepEnforcementEnabled(
  supabase: TypedSupabaseClient,
  enabled: boolean
) {
  const current = await getWorkflowSettings(supabase);
  return setWorkflowSettings(supabase, {
    ...current,
    stepEnforcementEnabled: enabled,
  });
}

export async function setWorkflowSettings(
  supabase: TypedSupabaseClient,
  settings: WorkflowSettings
) {
  const client = supabase;
  const organizationId = await getCurrentOrganizationId(client);
  const next = mapWorkflowSettings(settings);

  if (organizationId) {
    return client.from("organization_settings").upsert(
      {
        organization_id: organizationId,
        key: WORKFLOW_SETTINGS_KEY,
        value_json: next as unknown as Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,key" }
    );
  }

  // Transitional fallback while organization memberships/settings are being
  // seeded for the current dealership.
  return client.from("app_settings").upsert(
    {
      key: STEP_ENFORCEMENT_SETTING_KEY,
      value_json: next.stepEnforcementEnabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
}
