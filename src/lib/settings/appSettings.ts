const STEP_ENFORCEMENT_SETTING_KEY = "step_enforcement_enabled";

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{
          data: { value_json: unknown } | null;
          error: { message: string } | null;
        }>;
      };
    };
    upsert: (
      values: {
        key: string;
        value_json: boolean;
        updated_at: string;
      },
      options?: { onConflict?: string }
    ) => Promise<{ error: { message: string } | null }>;
  };
};

export async function getStepEnforcementEnabled(supabase: SupabaseLike) {
  const { data, error } = await supabase
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
  supabase: SupabaseLike,
  enabled: boolean
) {
  return supabase.from("app_settings").upsert(
    {
      key: STEP_ENFORCEMENT_SETTING_KEY,
      value_json: enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
}
