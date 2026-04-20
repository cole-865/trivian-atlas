"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { getAuthContext } from "@/lib/auth/userRole";
import {
  DEALERSHIP_PERMISSION_KEYS,
  type DealershipPermissionKey,
} from "@/lib/auth/permissionRegistry";
import {
  clearDealershipPermissionCache,
  requireDealershipPermission,
} from "@/lib/auth/dealershipPermissions";
import {
  isOrganizationAdminRole,
  ORG_MANAGED_ROLES,
} from "@/lib/auth/accessRules";
import { createAdminClient } from "@/lib/supabase/admin";
import { logOrganizationSettingsChange } from "@/lib/settings/audit";
import {
  INTEGRATION_SETTINGS_KEY,
  NOTIFICATION_SETTINGS_KEY,
  PRODUCT_PRICING_SETTINGS_KEY,
  loadOrganizationSetting,
  upsertOrganizationSetting,
} from "@/lib/settings/dealershipSettings";
import {
  getWorkflowSettings,
  setWorkflowSettings,
} from "@/lib/settings/appSettings";

const generalSchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required."),
  slug: z.string().trim().min(1, "Account slug is required."),
  legalBusinessName: z.string().trim().optional(),
  dbaName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  website: z.string().trim().optional(),
  mainEmail: z.union([z.email(), z.literal("")]).optional(),
  addressLine1: z.string().trim().optional(),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  country: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
});

const rolePermissionsSchema = z.object({
  role: z.enum(ORG_MANAGED_ROLES),
  permissions: z.array(z.enum(DEALERSHIP_PERMISSION_KEYS)),
});

const userOverrideSchema = z.object({
  userId: z.uuid(),
  permission: z.enum(DEALERSHIP_PERMISSION_KEYS),
  value: z.enum(["inherit", "true", "false"]),
});

const configSchema = z.object({
  apr: z.coerce.number().min(0).max(100),
  paymentCapPct: z.coerce.number().min(0).max(1),
  docFee: z.coerce.number().min(0),
  titleLicense: z.coerce.number().min(0),
  vscPrice: z.coerce.number().min(0),
  gapPrice: z.coerce.number().min(0),
  taxRateMain: z.coerce.number().min(0).max(1),
  taxAddBase: z.coerce.number().min(0),
  taxAddRate: z.coerce.number().min(0).max(1),
});

const tierPolicySchema = z.object({
  policyId: z.uuid(),
  apr: z.union([z.coerce.number().min(0).max(100), z.literal("")]),
  maxAmountFinanced: z.coerce.number().min(0),
  maxLtv: z.coerce.number().min(0).max(1000),
  maxPti: z.coerce.number().min(0).max(100),
  maxTermMonths: z.coerce.number().int().min(1).max(60),
  maxVehiclePrice: z.coerce.number().min(0),
  minCashDown: z.coerce.number().min(0),
  minDownPct: z.coerce.number().min(0).max(100),
  active: z.boolean(),
});

const vehicleTermPolicySchema = z.object({
  policyId: z.uuid(),
  maxTermMonths: z.coerce.number().int().min(1).max(60),
  minMileage: z.union([z.coerce.number().int().min(0), z.literal("")]),
  maxMileage: z.union([z.coerce.number().int().min(0), z.literal("")]),
  minVehicleAge: z.union([z.coerce.number().int().min(0), z.literal("")]),
  maxVehicleAge: z.union([z.coerce.number().int().min(0), z.literal("")]),
  notes: z.string().trim().optional(),
  active: z.boolean(),
});

const workflowSchema = z.object({
  stepEnforcementEnabled: z.boolean(),
  requireCreditBureauBeforeSubmit: z.boolean(),
  requireCustomerBeforeIncome: z.boolean(),
  requireUnderwritingDecisionBeforeVehicle: z.boolean(),
  allowAdminBypass: z.boolean(),
  lockCompletedStepsAfterSubmit: z.boolean(),
  requireManagerApprovalToReopenSubmittedDeals: z.boolean(),
});

function toBoolean(value: FormDataEntryValue | null) {
  return value === "on" || value === "true" || value === "1";
}

function nullableText(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function nullableNumber(value: number | "") {
  return value === "" ? null : value;
}

function percentToDecimal(value: number, inputIsPercent: boolean) {
  return inputIsPercent ? value / 100 : value;
}

function percentFormValue(formData: FormData, percentName: string, legacyName: string) {
  return formData.get(percentName) ?? formData.get(legacyName);
}

function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function redirectWithMessage(
  section: string,
  key: "notice" | "error",
  message: string
): never {
  const params = new URLSearchParams({ section });
  params.set(key, message);
  redirect(`/settings?${params.toString()}`);
}

function isNextRedirectError(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

async function getAuthorizedContext(permission: DealershipPermissionKey) {
  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);

  if (!authContext.currentOrganizationId) {
    throw new Error("Select an account before changing settings.");
  }

  await requireDealershipPermission(authContext, permission);

  return {
    supabase,
    authContext,
    organizationId: authContext.currentOrganizationId,
    userId: authContext.realUser?.id ?? null,
  };
}

async function getAuthorizedPermissionsContext() {
  const context = await getAuthorizedContext("manage_users");
  const isPlatformDev =
    context.authContext.realRole === "dev" && !context.authContext.isImpersonating;

  if (
    !isPlatformDev &&
    !isOrganizationAdminRole(context.authContext.effectiveOrganizationRole)
  ) {
    throw new Error("Only organization admins can manage role permissions.");
  }

  return context;
}

async function getBeforeRow(table: string, organizationId: string, filters?: Record<string, string>) {
  const admin = createAdminClient();
  const id = filters?.id;
  const userId = filters?.user_id;
  const permissionKey = filters?.permission_key;

  if (table === "organization_profile_settings") {
    const { data, error } = await admin
      .from("organization_profile_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load existing settings row: ${error.message}`);
    return (data ?? null) as Record<string, unknown> | null;
  }

  if (table === "organization_user_permission_overrides" && userId && permissionKey) {
    const { data, error } = await admin
      .from("organization_user_permission_overrides")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("permission_key", permissionKey)
      .maybeSingle();
    if (error) throw new Error(`Failed to load existing settings row: ${error.message}`);
    return (data ?? null) as Record<string, unknown> | null;
  }

  if (table === "trivian_config" && id) {
    const { data, error } = await admin
      .from("trivian_config")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Failed to load existing settings row: ${error.message}`);
    return (data ?? null) as Record<string, unknown> | null;
  }

  if (table === "underwriting_tier_policy" && id) {
    const { data, error } = await admin
      .from("underwriting_tier_policy")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Failed to load existing settings row: ${error.message}`);
    return (data ?? null) as Record<string, unknown> | null;
  }

  if (table === "vehicle_term_policy" && id) {
    const { data, error } = await admin
      .from("vehicle_term_policy")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Failed to load existing settings row: ${error.message}`);
    return (data ?? null) as Record<string, unknown> | null;
  }

  return null;
}

async function getBeforeOrganization(organizationId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("*")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load account: ${error.message}`);
  }

  return (data ?? null) as Record<string, unknown> | null;
}

export async function updateGeneralSettingsAction(formData: FormData) {
  try {
    const { organizationId, userId } = await getAuthorizedContext("manage_users");
    const parsed = generalSchema.parse({
      displayName: String(formData.get("display_name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      legalBusinessName: String(formData.get("legal_business_name") ?? ""),
      dbaName: String(formData.get("dba_name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      website: String(formData.get("website") ?? ""),
      mainEmail: String(formData.get("main_email") ?? ""),
      addressLine1: String(formData.get("address_line1") ?? ""),
      addressLine2: String(formData.get("address_line2") ?? ""),
      city: String(formData.get("city") ?? ""),
      state: String(formData.get("state") ?? ""),
      postalCode: String(formData.get("postal_code") ?? ""),
      country: String(formData.get("country") ?? ""),
      timezone: String(formData.get("timezone") ?? ""),
    });
    const admin = createAdminClient();
    const beforeOrg = await getBeforeOrganization(organizationId);
    const beforeProfile = await getBeforeRow("organization_profile_settings", organizationId);
    const now = new Date().toISOString();

    const orgUpdate = await admin
      .from("organizations")
      .update({
        name: parsed.displayName,
        slug: parsed.slug,
        updated_at: now,
      })
      .eq("id", organizationId)
      .select("id, name, slug, updated_at")
      .maybeSingle();

    if (orgUpdate.error) {
      throw new Error(`Failed to update account: ${orgUpdate.error.message}`);
    }

    const profilePayload = {
      organization_id: organizationId,
      legal_business_name: nullableText(parsed.legalBusinessName),
      dba_name: nullableText(parsed.dbaName),
      phone: nullableText(parsed.phone),
      website: nullableText(parsed.website),
      main_email: nullableText(parsed.mainEmail),
      address_line1: nullableText(parsed.addressLine1),
      address_line2: nullableText(parsed.addressLine2),
      city: nullableText(parsed.city),
      state: nullableText(parsed.state),
      postal_code: nullableText(parsed.postalCode),
      country: nullableText(parsed.country) ?? "US",
      timezone: nullableText(parsed.timezone) ?? "America/New_York",
      updated_at: now,
    };
    const profileUpdate = await admin
      .from("organization_profile_settings")
      .upsert(profilePayload, { onConflict: "organization_id" })
      .select("*")
      .maybeSingle();

    if (profileUpdate.error) {
      throw new Error(`Failed to update account profile: ${profileUpdate.error.message}`);
    }

    await logOrganizationSettingsChange({
      organizationId,
      changedByUserId: userId,
      changeType: "settings.general.updated",
      entityType: "organization_profile_settings",
      before: { organization: beforeOrg, profile: beforeProfile },
      after: { organization: orgUpdate.data, profile: profileUpdate.data },
    });

    revalidatePath("/", "layout");
    revalidatePath("/settings");
    redirectWithMessage("general", "notice", "General settings saved.");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithMessage("general", "error", error instanceof Error ? error.message : "Failed to save general settings.");
  }
}

export async function updateRolePermissionsAction(formData: FormData) {
  try {
    const { organizationId, userId } = await getAuthorizedPermissionsContext();
    const permissions = DEALERSHIP_PERMISSION_KEYS.filter(
      (permission) => formData.get(permission) === "on"
    );
    const parsed = rolePermissionsSchema.parse({
      role: String(formData.get("role") ?? ""),
      permissions,
    });
    const admin = createAdminClient();
    const before = await admin
      .from("organization_role_permissions")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("role", parsed.role);

    if (before.error) {
      throw new Error(`Failed to load role permissions: ${before.error.message}`);
    }

    const rows = DEALERSHIP_PERMISSION_KEYS.map((permission) => ({
      organization_id: organizationId,
      role: parsed.role,
      permission_key: permission,
      allowed: parsed.permissions.includes(permission),
      updated_at: new Date().toISOString(),
    }));
    const { data, error } = await admin
      .from("organization_role_permissions")
      .upsert(rows, { onConflict: "organization_id,role,permission_key" })
      .select("*");

    if (error) {
      throw new Error(`Failed to save role permissions: ${error.message}`);
    }

    clearDealershipPermissionCache({ organizationId });
    await logOrganizationSettingsChange({
      organizationId,
      changedByUserId: userId,
      changeType: "settings.permissions.role_updated",
      entityType: "organization_role_permissions",
      before: { role: parsed.role, permissions: before.data ?? [] },
      after: { role: parsed.role, permissions: data ?? [] },
    });

    revalidatePath("/settings");
    redirectWithMessage("permissions", "notice", "Role permissions saved.");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithMessage("permissions", "error", error instanceof Error ? error.message : "Failed to save role permissions.");
  }
}

export async function updateUserPermissionOverrideAction(formData: FormData) {
  try {
    const { organizationId, userId } = await getAuthorizedPermissionsContext();
    const parsed = userOverrideSchema.parse({
      userId: String(formData.get("user_id") ?? ""),
      permission: String(formData.get("permission") ?? ""),
      value: String(formData.get("value") ?? ""),
    });
    const admin = createAdminClient();
    const before = await getBeforeRow("organization_user_permission_overrides", organizationId, {
      user_id: parsed.userId,
      permission_key: parsed.permission,
    });

    let after: Record<string, unknown> | null = null;
    if (parsed.value === "inherit") {
      const { error } = await admin
        .from("organization_user_permission_overrides")
        .delete()
        .eq("organization_id", organizationId)
        .eq("user_id", parsed.userId)
        .eq("permission_key", parsed.permission);

      if (error) {
        throw new Error(`Failed to clear permission override: ${error.message}`);
      }
    } else {
      const { data, error } = await admin
        .from("organization_user_permission_overrides")
        .upsert(
          {
            organization_id: organizationId,
            user_id: parsed.userId,
            permission_key: parsed.permission,
            allowed: parsed.value === "true",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,user_id,permission_key" }
        )
        .select("*")
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to save permission override: ${error.message}`);
      }
      after = (data ?? null) as Record<string, unknown> | null;
    }

    clearDealershipPermissionCache({ organizationId, userId: parsed.userId });
    await logOrganizationSettingsChange({
      organizationId,
      changedByUserId: userId,
      changeType: "settings.permissions.user_override_updated",
      entityType: "organization_user_permission_overrides",
      before: objectPayload(before),
      after,
    });

    revalidatePath("/settings");
    redirectWithMessage("permissions", "notice", "User permission override saved.");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithMessage("permissions", "error", error instanceof Error ? error.message : "Failed to save permission override.");
  }
}

export async function updateWorkflowSettingsAction(formData: FormData) {
  try {
    const { supabase, organizationId, userId } =
      await getAuthorizedContext("manage_workflow_settings");
    const parsed = workflowSchema.parse({
      stepEnforcementEnabled: toBoolean(formData.get("step_enforcement_enabled")),
      requireCreditBureauBeforeSubmit: toBoolean(formData.get("require_credit_bureau_before_submit")),
      requireCustomerBeforeIncome: toBoolean(formData.get("require_customer_before_income")),
      requireUnderwritingDecisionBeforeVehicle: toBoolean(formData.get("require_underwriting_decision_before_vehicle")),
      allowAdminBypass: toBoolean(formData.get("allow_admin_bypass")),
      lockCompletedStepsAfterSubmit: toBoolean(formData.get("lock_completed_steps_after_submit")),
      requireManagerApprovalToReopenSubmittedDeals: toBoolean(formData.get("require_manager_approval_to_reopen")),
    });
    const before = await getWorkflowSettings(supabase);
    const response = await setWorkflowSettings(supabase, parsed);
    if (response.error) {
      throw new Error(`Failed to save workflow settings: ${response.error.message}`);
    }

    await logOrganizationSettingsChange({
      organizationId,
      changedByUserId: userId,
      changeType: "settings.workflow.updated",
      entityType: "organization_settings",
      before,
      after: parsed,
    });

    revalidatePath("/settings");
    redirectWithMessage("workflow", "notice", "Workflow settings saved.");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithMessage("workflow", "error", error instanceof Error ? error.message : "Failed to save workflow settings.");
  }
}

export async function updateTrivianConfigAction(formData: FormData) {
  try {
    const { organizationId, userId } =
      await getAuthorizedContext("manage_underwriting_settings");
    const parsed = configSchema.parse({
      apr: formData.get("apr"),
      paymentCapPct: formData.get("payment_cap_pct"),
      docFee: formData.get("doc_fee"),
      titleLicense: formData.get("title_license"),
      vscPrice: formData.get("vsc_price"),
      gapPrice: formData.get("gap_price"),
      taxRateMain: formData.get("tax_rate_main"),
      taxAddBase: formData.get("tax_add_base"),
      taxAddRate: formData.get("tax_add_rate"),
    });
    const admin = createAdminClient();
    const before = await getBeforeRow("trivian_config", organizationId, {
      id: String(formData.get("config_id") ?? ""),
    });
    const payload = {
      apr: parsed.apr,
      payment_cap_pct: parsed.paymentCapPct,
      doc_fee: parsed.docFee,
      title_license: parsed.titleLicense,
      vsc_price: parsed.vscPrice,
      gap_price: parsed.gapPrice,
      tax_rate_main: parsed.taxRateMain,
      tax_add_base: parsed.taxAddBase,
      tax_add_rate: parsed.taxAddRate,
      updated_at: new Date().toISOString(),
    };
    const query = admin
      .from("trivian_config")
      .update(payload)
      .eq("organization_id", organizationId)
      .eq("id", String(formData.get("config_id") ?? ""));
    const { data, error } = await query.select("*").maybeSingle();

    if (error) {
      throw new Error(`Failed to save pricing/config defaults: ${error.message}`);
    }

    await upsertOrganizationSetting({
      organizationId,
      key: PRODUCT_PRICING_SETTINGS_KEY,
      value: {
        packFee: String(formData.get("pack_fee") ?? "").trim()
          ? Number(formData.get("pack_fee"))
          : null,
        supportedPaymentFrequencies: ["monthly"],
      },
    });

    await logOrganizationSettingsChange({
      organizationId,
      changedByUserId: userId,
      changeType: "settings.config.updated",
      entityType: "trivian_config",
      before,
      after: (data ?? null) as Record<string, unknown> | null,
    });

    revalidatePath("/settings");
    redirectWithMessage("products", "notice", "Products and pricing saved.");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithMessage("products", "error", error instanceof Error ? error.message : "Failed to save products and pricing.");
  }
}

export async function updateTierPolicyAction(formData: FormData) {
  try {
    const { organizationId, userId } =
      await getAuthorizedContext("manage_underwriting_settings");
    const usesPercentInputs = {
      maxLtv: formData.has("max_ltv_percent"),
      maxPti: formData.has("max_pti_percent"),
      minDownPct: formData.has("min_down_pct_percent"),
    };
    const parsed = tierPolicySchema.parse({
      policyId: String(formData.get("policy_id") ?? ""),
      apr: String(formData.get("apr") ?? ""),
      maxAmountFinanced: formData.get("max_amount_financed"),
      maxLtv: percentFormValue(formData, "max_ltv_percent", "max_ltv"),
      maxPti: percentFormValue(formData, "max_pti_percent", "max_pti"),
      maxTermMonths: formData.get("max_term_months"),
      maxVehiclePrice: formData.get("max_vehicle_price"),
      minCashDown: formData.get("min_cash_down"),
      minDownPct: percentFormValue(formData, "min_down_pct_percent", "min_down_pct"),
      active: toBoolean(formData.get("active")),
    });
    const admin = createAdminClient();
    const before = await getBeforeRow("underwriting_tier_policy", organizationId, {
      id: parsed.policyId,
    });
    const { data, error } = await admin
      .from("underwriting_tier_policy")
      .update({
        apr: nullableNumber(parsed.apr),
        max_amount_financed: parsed.maxAmountFinanced,
        max_ltv: percentToDecimal(parsed.maxLtv, usesPercentInputs.maxLtv),
        max_pti: percentToDecimal(parsed.maxPti, usesPercentInputs.maxPti),
        max_term_months: parsed.maxTermMonths,
        max_vehicle_price: parsed.maxVehiclePrice,
        min_cash_down: parsed.minCashDown,
        min_down_pct: percentToDecimal(parsed.minDownPct, usesPercentInputs.minDownPct),
        active: parsed.active,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId)
      .eq("id", parsed.policyId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to save underwriting tier: ${error.message}`);
    }

    await logOrganizationSettingsChange({
      organizationId,
      changedByUserId: userId,
      changeType: "settings.underwriting.tier_updated",
      entityType: "underwriting_tier_policy",
      before,
      after: (data ?? null) as Record<string, unknown> | null,
    });

    revalidatePath("/settings");
    redirectWithMessage("underwriting", "notice", "Underwriting tier saved.");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithMessage("underwriting", "error", error instanceof Error ? error.message : "Failed to save underwriting tier.");
  }
}

export async function updateVehicleTermPolicyAction(formData: FormData) {
  try {
    const { organizationId, userId } =
      await getAuthorizedContext("manage_underwriting_settings");
    const parsed = vehicleTermPolicySchema.parse({
      policyId: String(formData.get("policy_id") ?? ""),
      maxTermMonths: formData.get("max_term_months"),
      minMileage: String(formData.get("min_mileage") ?? ""),
      maxMileage: String(formData.get("max_mileage") ?? ""),
      minVehicleAge: String(formData.get("min_vehicle_age") ?? ""),
      maxVehicleAge: String(formData.get("max_vehicle_age") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      active: toBoolean(formData.get("active")),
    });
    const admin = createAdminClient();
    const before = await getBeforeRow("vehicle_term_policy", organizationId, {
      id: parsed.policyId,
    });
    const { data, error } = await admin
      .from("vehicle_term_policy")
      .update({
        max_term_months: parsed.maxTermMonths,
        min_mileage: nullableNumber(parsed.minMileage),
        max_mileage: nullableNumber(parsed.maxMileage),
        min_vehicle_age: nullableNumber(parsed.minVehicleAge),
        max_vehicle_age: nullableNumber(parsed.maxVehicleAge),
        notes: nullableText(parsed.notes),
        active: parsed.active,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId)
      .eq("id", parsed.policyId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to save vehicle term policy: ${error.message}`);
    }

    await logOrganizationSettingsChange({
      organizationId,
      changedByUserId: userId,
      changeType: "settings.underwriting.vehicle_term_updated",
      entityType: "vehicle_term_policy",
      before,
      after: (data ?? null) as Record<string, unknown> | null,
    });

    revalidatePath("/settings");
    redirectWithMessage("underwriting", "notice", "Vehicle term policy saved.");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithMessage("underwriting", "error", error instanceof Error ? error.message : "Failed to save vehicle term policy.");
  }
}

export async function updateNotificationsAction(formData: FormData) {
  try {
    const { organizationId, userId } = await getAuthorizedContext("manage_integrations");
    const after = {
      dealSubmittedAlerts: toBoolean(formData.get("deal_submitted_alerts")),
      overrideRequestAlerts: toBoolean(formData.get("override_request_alerts")),
      creditDecisionAlerts: toBoolean(formData.get("credit_decision_alerts")),
      failedDocumentParsingAlerts: toBoolean(formData.get("failed_document_parsing_alerts")),
      fundingReadyAlerts: toBoolean(formData.get("funding_ready_alerts")),
    };
    const before = await loadOrganizationSetting(organizationId, NOTIFICATION_SETTINGS_KEY);
    await upsertOrganizationSetting({
      organizationId,
      key: NOTIFICATION_SETTINGS_KEY,
      value: after,
    });
    await logOrganizationSettingsChange({
      organizationId,
      changedByUserId: userId,
      changeType: "settings.notifications.updated",
      entityType: "organization_settings",
      before: objectPayload(before),
      after,
    });
    revalidatePath("/settings");
    redirectWithMessage("notifications", "notice", "Notification preferences saved.");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithMessage("notifications", "error", error instanceof Error ? error.message : "Failed to save notifications.");
  }
}

export async function updateIntegrationsAction(formData: FormData) {
  try {
    const { organizationId, userId } = await getAuthorizedContext("manage_integrations");
    const after = {
      inventoryImportEnabled: toBoolean(formData.get("inventory_import_enabled")),
      webhookPlaceholdersEnabled: toBoolean(formData.get("webhook_placeholders_enabled")),
    };
    const before = await loadOrganizationSetting(organizationId, INTEGRATION_SETTINGS_KEY);
    await upsertOrganizationSetting({
      organizationId,
      key: INTEGRATION_SETTINGS_KEY,
      value: after,
    });
    await logOrganizationSettingsChange({
      organizationId,
      changedByUserId: userId,
      changeType: "settings.integrations.updated",
      entityType: "organization_settings",
      before: objectPayload(before),
      after,
    });
    revalidatePath("/settings");
    redirectWithMessage("integrations", "notice", "Integration settings saved.");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithMessage("integrations", "error", error instanceof Error ? error.message : "Failed to save integrations.");
  }
}
