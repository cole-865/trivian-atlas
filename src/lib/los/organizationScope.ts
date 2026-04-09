import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";

type QueryError = {
  message: string;
};

type QueryListResult<T> = {
  data: T[] | null;
  error: QueryError | null;
};

type QuerySingleResult<T> = {
  data: T | null;
  error: QueryError | null;
};

type SupabaseLike = {
  from: (table: string) => SelectCapable;
};

type QueryBuilder<T> = PromiseLike<QueryListResult<T>> & {
  eq: (column: string, value: unknown) => QueryBuilder<T>;
  order: (
    column: string,
    options?: { ascending: boolean }
  ) => QueryBuilder<T>;
  limit: (count: number) => QueryBuilder<T>;
  maybeSingle: () => Promise<QuerySingleResult<T>>;
  is: (column: string, value: null) => QueryBuilder<T>;
  range: (from: number, to: number) => Promise<QueryListResult<T>>;
};

type SelectCapable = {
  select: <T = Record<string, unknown>>(columns: string) => QueryBuilder<T>;
};

function asSupabaseClient(supabase: unknown) {
  return supabase as SupabaseLike;
}

export async function loadActiveVehicleTermPolicies<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  supabase: unknown,
  organizationId: string
): Promise<QueryListResult<T>> {
  const client = asSupabaseClient(supabase);

  return scopeQueryToOrganization(
    client
      .from("vehicle_term_policy")
      .select<T>(
        "id, sort_order, min_mileage, max_mileage, min_vehicle_age, max_vehicle_age, max_term_months, active, notes"
      ),
    organizationId
  )
    .eq("active", true)
    .order("sort_order", { ascending: true });
}

export async function loadActiveUnderwritingTierPolicy<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  supabase: unknown,
  organizationId: string,
  tier: string
): Promise<QuerySingleResult<T>> {
  const client = asSupabaseClient(supabase);

  return scopeQueryToOrganization(
    client
      .from("underwriting_tier_policy")
      .select<T>(
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

export async function loadLatestTrivianConfig<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  supabase: unknown,
  organizationId: string,
  columns: string
): Promise<QuerySingleResult<T>> {
  const client = asSupabaseClient(supabase);

  const organizationScopedResponse = await scopeQueryToOrganization(
    client.from("trivian_config").select<T>(columns),
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
    .select<T>(columns)
    .is("organization_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function loadInventoryVehicleForOrganization<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  supabase: unknown,
  organizationId: string,
  vehicleId: string,
  columns: string
): Promise<QuerySingleResult<T>> {
  const client = asSupabaseClient(supabase);

  return scopeQueryToOrganization(
    client.from("trivian_inventory").select<T>(columns),
    organizationId
  )
    .eq("status", "IN INVENTORY")
    .eq("id", vehicleId)
    .maybeSingle();
}

export async function loadInventoryForOrganization<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  supabase: unknown,
  organizationId: string,
  columns: string,
  options?: {
    offset?: number;
    limit?: number;
  }
): Promise<QueryListResult<T>> {
  const client = asSupabaseClient(supabase);
  const offset = Math.max(Number(options?.offset ?? 0), 0);
  const limit = Math.max(Number(options?.limit ?? 200), 1);

  return scopeQueryToOrganization(
    client.from("trivian_inventory").select<T>(columns),
    organizationId
  )
    .eq("status", "IN INVENTORY")
    .order("date_in_stock", { ascending: true })
    .range(offset, offset + limit - 1);
}
