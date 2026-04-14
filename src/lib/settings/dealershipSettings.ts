import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.generated";
import {
  DEALERSHIP_PERMISSION_KEYS,
  isDealershipPermissionKey,
  type DealershipPermissionKey,
} from "@/lib/auth/permissionRegistry";
import type { OrganizationScopedRole } from "@/lib/auth/accessRules";
import type {
  RolePermissionRow,
  UserPermissionOverrideRow,
} from "@/lib/auth/dealershipPermissions";

export const NOTIFICATION_SETTINGS_KEY = "notifications";
export const INTEGRATION_SETTINGS_KEY = "integrations";
export const PRODUCT_PRICING_SETTINGS_KEY = "product_pricing";

export type OrganizationProfileSettings = {
  organization_id: string;
  legal_business_name: string | null;
  dba_name: string | null;
  phone: string | null;
  website: string | null;
  main_email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  timezone: string | null;
  logo_storage_path: string | null;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TrivianConfigRow = {
  id: string;
  organization_id: string | null;
  apr: number;
  doc_fee: number;
  gap_price: number;
  payment_cap_pct: number;
  tax_add_base: number;
  tax_add_rate: number;
  tax_rate_main: number;
  title_license: number;
  vsc_price: number;
  created_at: string;
  updated_at: string;
};

export type UnderwritingTierPolicyRow = {
  id: string;
  organization_id: string | null;
  tier: string;
  active: boolean;
  sort_order: number;
  apr: number | null;
  max_amount_financed: number;
  max_ltv: number;
  max_pti: number;
  max_term_months: number;
  max_vehicle_price: number;
  min_cash_down: number;
  min_down_pct: number;
};

export type VehicleTermPolicyRow = {
  id: string;
  organization_id: string | null;
  active: boolean;
  sort_order: number;
  min_mileage: number | null;
  max_mileage: number | null;
  min_vehicle_age: number | null;
  max_vehicle_age: number | null;
  max_term_months: number;
  notes: string | null;
};

export type AuditLogRow = {
  id: string;
  organization_id: string | null;
  changed_by_user_id: string | null;
  change_type: string | null;
  entity_type: string | null;
  before: Json | null;
  after: Json | null;
  created_at: string;
};

export type NotificationSettings = {
  dealSubmittedAlerts: boolean;
  overrideRequestAlerts: boolean;
  creditDecisionAlerts: boolean;
  failedDocumentParsingAlerts: boolean;
  fundingReadyAlerts: boolean;
};

export type IntegrationSettings = {
  inventoryImportEnabled: boolean;
  webhookPlaceholdersEnabled: boolean;
};

export type ProductPricingSettings = {
  packFee: number | null;
  supportedPaymentFrequencies: string[];
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  dealSubmittedAlerts: true,
  overrideRequestAlerts: true,
  creditDecisionAlerts: true,
  failedDocumentParsingAlerts: true,
  fundingReadyAlerts: true,
};

export const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettings = {
  inventoryImportEnabled: false,
  webhookPlaceholdersEnabled: false,
};

export const DEFAULT_PRODUCT_PRICING_SETTINGS: ProductPricingSettings = {
  packFee: null,
  supportedPaymentFrequencies: ["monthly"],
};

export type DealershipSettingsData = {
  organization: OrganizationSummary | null;
  profile: OrganizationProfileSettings | null;
  rolePermissions: RolePermissionRow[];
  userPermissionOverrides: UserPermissionOverrideRow[];
  trivianConfig: TrivianConfigRow | null;
  tierPolicies: UnderwritingTierPolicyRow[];
  vehicleTermPolicies: VehicleTermPolicyRow[];
  notifications: NotificationSettings;
  integrations: IntegrationSettings;
  productPricing: ProductPricingSettings;
  auditLogs: AuditLogRow[];
};

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function nullableNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function mapNotificationSettings(value: unknown): NotificationSettings {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    dealSubmittedAlerts: bool(
      record.dealSubmittedAlerts,
      DEFAULT_NOTIFICATION_SETTINGS.dealSubmittedAlerts
    ),
    overrideRequestAlerts: bool(
      record.overrideRequestAlerts,
      DEFAULT_NOTIFICATION_SETTINGS.overrideRequestAlerts
    ),
    creditDecisionAlerts: bool(
      record.creditDecisionAlerts,
      DEFAULT_NOTIFICATION_SETTINGS.creditDecisionAlerts
    ),
    failedDocumentParsingAlerts: bool(
      record.failedDocumentParsingAlerts,
      DEFAULT_NOTIFICATION_SETTINGS.failedDocumentParsingAlerts
    ),
    fundingReadyAlerts: bool(
      record.fundingReadyAlerts,
      DEFAULT_NOTIFICATION_SETTINGS.fundingReadyAlerts
    ),
  };
}

function mapIntegrationSettings(value: unknown): IntegrationSettings {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    inventoryImportEnabled: bool(
      record.inventoryImportEnabled,
      DEFAULT_INTEGRATION_SETTINGS.inventoryImportEnabled
    ),
    webhookPlaceholdersEnabled: bool(
      record.webhookPlaceholdersEnabled,
      DEFAULT_INTEGRATION_SETTINGS.webhookPlaceholdersEnabled
    ),
  };
}

function mapProductPricingSettings(value: unknown): ProductPricingSettings {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const supportedPaymentFrequencies = Array.isArray(record.supportedPaymentFrequencies)
    ? record.supportedPaymentFrequencies.filter(
        (frequency): frequency is string => typeof frequency === "string"
      )
    : DEFAULT_PRODUCT_PRICING_SETTINGS.supportedPaymentFrequencies;

  return {
    packFee:
      record.packFee === null || record.packFee === ""
        ? null
        : nullableNumber(record.packFee),
    supportedPaymentFrequencies: supportedPaymentFrequencies.length
      ? supportedPaymentFrequencies
      : DEFAULT_PRODUCT_PRICING_SETTINGS.supportedPaymentFrequencies,
  };
}

export async function loadOrganizationSetting(
  organizationId: string,
  key: string
): Promise<unknown> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_settings")
    .select("value_json")
    .eq("organization_id", organizationId)
    .eq("key", key)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load organization setting: ${error.message}`);
  }

  return (data as { value_json?: unknown } | null)?.value_json ?? null;
}

export async function getNotificationSettingsForOrganization(organizationId: string) {
  return mapNotificationSettings(
    await loadOrganizationSetting(organizationId, NOTIFICATION_SETTINGS_KEY)
  );
}

export async function upsertOrganizationSetting(args: {
  organizationId: string;
  key: string;
  value: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("organization_settings").upsert(
    {
      organization_id: args.organizationId,
      key: args.key,
      value_json: args.value as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,key" }
  );

  if (error) {
    throw new Error(`Failed to save organization setting: ${error.message}`);
  }
}

export async function loadDealershipSettingsData(
  organizationId: string
): Promise<DealershipSettingsData> {
  const admin = createAdminClient();
  const [
    organization,
    profile,
    rolePermissions,
    userOverrides,
    trivianConfig,
    tierPolicies,
    vehiclePolicies,
    notificationSetting,
    integrationSetting,
    productPricingSetting,
    auditLogs,
  ] = await Promise.all([
    admin
      .from("organizations")
      .select("id, name, slug, is_active, created_at, updated_at")
      .eq("id", organizationId)
      .maybeSingle(),
    admin
      .from("organization_profile_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    admin
      .from("organization_role_permissions")
      .select("organization_id, role, permission_key, allowed")
      .eq("organization_id", organizationId),
    admin
      .from("organization_user_permission_overrides")
      .select("organization_id, user_id, permission_key, allowed")
      .eq("organization_id", organizationId),
    admin
      .from("trivian_config")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("underwriting_tier_policy")
      .select("*")
      .eq("organization_id", organizationId)
      .order("sort_order", { ascending: true }),
    admin
      .from("vehicle_term_policy")
      .select("*")
      .eq("organization_id", organizationId)
      .order("sort_order", { ascending: true }),
    loadOrganizationSetting(organizationId, NOTIFICATION_SETTINGS_KEY),
    loadOrganizationSetting(organizationId, INTEGRATION_SETTINGS_KEY),
    loadOrganizationSetting(organizationId, PRODUCT_PRICING_SETTINGS_KEY),
    admin
      .from("audit_log")
      .select("id, organization_id, changed_by_user_id, change_type, entity_type, before, after, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  for (const response of [
    organization,
    profile,
    rolePermissions,
    userOverrides,
    trivianConfig,
    tierPolicies,
    vehiclePolicies,
    auditLogs,
  ]) {
    if (response.error) {
      throw new Error(`Failed to load dealership settings: ${response.error.message}`);
    }
  }

  return {
    organization: (organization.data as OrganizationSummary | null) ?? null,
    profile: (profile.data as OrganizationProfileSettings | null) ?? null,
    rolePermissions: ((rolePermissions.data ?? []) as RolePermissionRow[]).filter(
      (row) => isDealershipPermissionKey(row.permission_key)
    ),
    userPermissionOverrides: (
      (userOverrides.data ?? []) as UserPermissionOverrideRow[]
    ).filter((row) => isDealershipPermissionKey(row.permission_key)),
    trivianConfig: (trivianConfig.data as TrivianConfigRow | null) ?? null,
    tierPolicies: (tierPolicies.data ?? []) as UnderwritingTierPolicyRow[],
    vehicleTermPolicies: (vehiclePolicies.data ?? []) as VehicleTermPolicyRow[],
    notifications: mapNotificationSettings(notificationSetting),
    integrations: mapIntegrationSettings(integrationSetting),
    productPricing: mapProductPricingSettings(productPricingSetting),
    auditLogs: (auditLogs.data ?? []) as AuditLogRow[],
  };
}

export function buildRolePermissionMatrix(rows: RolePermissionRow[]) {
  const matrix = new Map<string, boolean>();
  for (const row of rows) {
    matrix.set(`${row.role}:${row.permission_key}`, row.allowed);
  }
  return matrix;
}

export function rolePermissionAllowed(args: {
  rows: RolePermissionRow[];
  role: OrganizationScopedRole;
  permission: DealershipPermissionKey;
}) {
  const matrix = buildRolePermissionMatrix(args.rows);
  return matrix.get(`${args.role}:${args.permission}`) ?? false;
}

export function allPermissionKeysFromForm(formData: FormData) {
  return DEALERSHIP_PERMISSION_KEYS.filter(
    (permission) => formData.get(permission) === "on"
  );
}

export function parsePermissionKey(value: FormDataEntryValue | null) {
  const permission = String(value ?? "");
  return isDealershipPermissionKey(permission) ? permission : null;
}
