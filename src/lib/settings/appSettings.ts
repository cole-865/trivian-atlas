import { getCurrentOrganizationId } from "@/lib/auth/organizationContext";

const STEP_ENFORCEMENT_SETTING_KEY = "step_enforcement_enabled";

type SupabaseLike = {
  from: (table: string) => any;
};

export async function getStepEnforcementEnabled(supabase: unknown) {
  const client = supabase as SupabaseLike;
  const organizationId = await getCurrentOrganizationId(client);

  if (organizationId) {
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
      return data.value_json;
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

  return typeof data?.value_json === "boolean" ? data.value_json : true;
}

export async function setStepEnforcementEnabled(
  supabase: unknown,
  enabled: boolean
) {
  const client = supabase as SupabaseLike;
  const organizationId = await getCurrentOrganizationId(client);

  if (organizationId) {
    return client.from("organization_settings").upsert(
      {
        organization_id: organizationId,
        key: STEP_ENFORCEMENT_SETTING_KEY,
        value_json: enabled,
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
      value_json: enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
}
