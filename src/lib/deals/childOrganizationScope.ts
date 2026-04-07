import { getCurrentOrganizationIdForDeals } from "@/lib/deals/organizationScope";

type ScopedLookupResult<T> = {
  organizationId: string | null;
  data: T | null;
  error: { message: string } | null;
};

type SupabaseEqQuery<T> = {
  eq: (column: string, value: string) => SupabaseEqQuery<T>;
  maybeSingle: () => Promise<{
    data: T | null;
    error: { message: string } | null;
  }>;
};

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => SupabaseEqQuery<unknown>;
  };
};

function asSupabaseClient(supabase: unknown) {
  return supabase as SupabaseLike;
}

export function scopeQueryToOrganization<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  organizationId: string
) {
  return query.eq("organization_id", organizationId);
}

export async function getDealPersonForCurrentOrganization<
  T = Record<string, unknown>,
>(
  supabase: unknown,
  dealId: string,
  role: string,
  columns = "id"
): Promise<ScopedLookupResult<T>> {
  const client = asSupabaseClient(supabase);
  const organizationId = await getCurrentOrganizationIdForDeals(client);

  if (!organizationId) {
    return {
      organizationId: null,
      data: null,
      error: null,
    };
  }

  const { data, error } = await scopeQueryToOrganization(
    client.from("deal_people").select(columns),
    organizationId
  )
    .eq("deal_id", dealId)
    .eq("role", role)
    .maybeSingle();

  return {
    organizationId,
    data: (data as T | null) ?? null,
    error: error ?? null,
  };
}
