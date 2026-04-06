type PrimaryNameRow = {
  deal_id: string;
  first_name: unknown;
  last_name: unknown;
};

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        in: (
          column: string,
          values: string[]
        ) => Promise<{
          data: PrimaryNameRow[] | null;
          error: unknown;
        }>;
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
  supabase: SupabaseLike,
  dealIds: string[]
): Promise<Record<string, string>> {
  const uniqueDealIds = Array.from(
    new Set((dealIds ?? []).map((dealId) => String(dealId)).filter(Boolean))
  );

  if (!uniqueDealIds.length) {
    return {};
  }

  const { data, error } = await supabase
    .from("deal_people")
    .select("deal_id, first_name, last_name")
    .eq("role", "primary")
    .in("deal_id", uniqueDealIds);

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
