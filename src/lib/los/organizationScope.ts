import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";

type SupabaseLike = {
  from: (table: string) => SelectCapable;
};

type QueryBuilder = {
  eq: (column: string, value: unknown) => QueryBuilder;
  order: (
    column: string,
    options?: { ascending: boolean }
  ) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  maybeSingle: () => Promise<{
    data: unknown | null;
    error: { message: string } | null;
  }>;
  is: (column: string, value: null) => QueryBuilder;
  range: (from: number, to: number) => QueryBuilder;
};

type SelectCapable = {
  select: (columns: string) => QueryBuilder;
};

function asSupabaseClient(supabase: unknown) {
  return supabase as SupabaseLike;
}

export async function loadActiveVehicleTermPolicies(
  supabase: unknown,
  organizationId: string
) {
  const client = asSupabaseClient(supabase);

  return scopeQueryToOrganization(
    client
      .from("vehicle_term_policy")
      .select(
        "id, sort_order, min_mileage, max_mileage, min_vehicle_age, max_vehicle_age, max_term_months, active, notes"
      ),
    organizationId
  )
    .eq("active", true)
    .order("sort_order", { ascending: true });
}

export async function loadActiveUnderwritingTierPolicy(
  supabase: unknown,
  organizationId: string,
  tier: string
) {
  const client = asSupabaseClient(supabase);

  return scopeQueryToOrganization(
    client
      .from("underwriting_tier_policy")
      .select(
        "tier, max_vehicle_price, max_amount_financed, max_ltv, max_term_months, max_pti, min_cash_down, min_down_pct, apr"
      ),
    organizationId
  )
    .eq("tier", tier)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function loadLatestTrivianConfig(
  supabase: unknown,
  organizationId: string,
  columns: string
) {
  const client = asSupabaseClient(supabase);

  const organizationScopedResponse = await scopeQueryToOrganization(
    client.from("trivian_config").select(columns),
    organizationId
  )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (organizationScopedResponse.error) {
    return organizationScopedResponse;
  }

  if (organizationScopedResponse.data) {
    return organizationScopedResponse;
  }

  // Transitional fallback while trivian_config rows are being migrated from
  // global/default rows into organization-scoped rows.
  return client
    .from("trivian_config")
    .select(columns)
    .is("organization_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function loadInventoryVehicleForOrganization(
  supabase: unknown,
  organizationId: string,
  vehicleId: string,
  columns: string
) {
  const client = asSupabaseClient(supabase);

  return scopeQueryToOrganization(
    client.from("trivian_inventory").select(columns),
    organizationId
  )
    .eq("status", "IN INVENTORY")
    .eq("id", vehicleId)
    .maybeSingle();
}

export async function loadInventoryForOrganization(
  supabase: unknown,
  organizationId: string,
  columns: string,
  options?: {
    offset?: number;
    limit?: number;
  }
) {
  const client = asSupabaseClient(supabase);
  const offset = Math.max(Number(options?.offset ?? 0), 0);
  const limit = Math.max(Number(options?.limit ?? 200), 1);

  return scopeQueryToOrganization(
    client.from("trivian_inventory").select(columns),
    organizationId
  )
    .eq("status", "IN INVENTORY")
    .order("date_in_stock", { ascending: true })
    .range(offset, offset + limit - 1);
}
