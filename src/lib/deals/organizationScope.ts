import { getCurrentOrganizationId } from "@/lib/auth/organizationContext";

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => DealSelectBuilder<unknown>;
  };
};

type DealSelectBuilder<T> = {
  eq: (column: string, value: string) => DealSelectBuilder<T>;
  maybeSingle: () => Promise<{
    data: T | null;
    error: { message: string } | null;
  }>;
};

export const NO_CURRENT_ORGANIZATION_MESSAGE =
  "No active organization is selected for this user.";

export type ScopedDealLookupResult<T> = {
  organizationId: string | null;
  data: T | null;
  error: { message: string } | null;
};

function asSupabaseClient(supabase: unknown): SupabaseLike {
  return supabase as SupabaseLike;
}

export async function getCurrentOrganizationIdForDeals(
  supabase: unknown
): Promise<string | null> {
  return getCurrentOrganizationId(supabase);
}

export async function getDealForCurrentOrganization<T = Record<string, unknown>>(
  supabase: unknown,
  dealId: string,
  columns = "id"
): Promise<ScopedDealLookupResult<T>> {
  const client = asSupabaseClient(supabase);
  const organizationId = await getCurrentOrganizationIdForDeals(client);

  if (!organizationId) {
    return {
      organizationId: null,
      data: null,
      error: null,
    };
  }

  const { data, error } = await client
    .from("deals")
    .select(columns)
    .eq("id", dealId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  return {
    organizationId,
    data: (data as T | null) ?? null,
    error: error ?? null,
  };
}

export async function assertDealInCurrentOrganization(
  supabase: unknown,
  dealId: string
) {
  return getDealForCurrentOrganization(supabase, dealId, "id");
}
