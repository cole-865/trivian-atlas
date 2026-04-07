type PrimaryNameRow = {
  deal_id: string;
  first_name: unknown;
  last_name: unknown;
};

type QueryResult<T> = PromiseLike<{
  data: T | null;
  error: unknown;
}>;

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        eq: (
          column: string,
          value: string
        ) => {
          in: (
            column: string,
            values: string[]
          ) => QueryResult<PrimaryNameRow[]>;
        };
        in: (
          column: string,
          values: string[]
        ) => QueryResult<PrimaryNameRow[]>;
      };
    };
  };
};

function normalizeNamePart(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

export function buildCustomerName(firstName: unknown, lastName: unknown) {
  const first = normalizeNamePart(firstName) ?? "";
  const last = normalizeNamePart(lastName) ?? "";
  const full = `${first} ${last}`.trim();
  return full.length ? full : null;
}

export async function loadPrimaryCustomerNames(
  supabase: unknown,
  dealIds: string[],
  organizationId?: string | null
): Promise<Record<string, string>> {
  const client = supabase as SupabaseLike;
  const uniqueDealIds = Array.from(
    new Set((dealIds ?? []).map((dealId) => String(dealId)).filter(Boolean))
  );

  if (!uniqueDealIds.length) {
    return {};
  }

  let query = client
    .from("deal_people")
    .select("deal_id, first_name, last_name")
    .eq("role", "primary");

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query.in("deal_id", uniqueDealIds);

  if (error) {
    console.error("loadPrimaryCustomerNames error:", error);
    return {};
  }

  const names: Record<string, string> = {};

  for (const row of data ?? []) {
    const name = buildCustomerName(row.first_name, row.last_name);
    if (name) {
      names[String(row.deal_id)] = name;
    }
  }

  return names;
}
