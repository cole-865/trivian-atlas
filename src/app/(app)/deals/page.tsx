import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

type Props = {
  searchParams?: Promise<{ q?: string }>;
};

export default async function DealsPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const q = (sp.q ?? "").trim();

  const supabase = await createClient();

  // basic search: by customer_name or id text
  let query = supabase
    .from("deals")
    .select("id, customer_name, status, updated_at, created_at")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (q) {
    // UUID search works via id::text ilike
    query = query.or(
      `customer_name.ilike.%${q}%,id::text.ilike.%${q}%`
    ) as any;
  }

  const { data, error } = await query;

  if (error) {
    return (
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-lg font-semibold">Deals</div>
        <div className="mt-2 text-sm text-red-600">{error.message}</div>
      </div>
    );
  }

  const deals = data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xl font-semibold">Deals</div>
        <div className="text-xs text-muted-foreground">
          {q ? `Search: "${q}"` : "Most recently updated"}
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        {deals.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No deals found.</div>
        ) : (
          <div className="divide-y">
            {deals.map((d) => (
              <Link
                key={d.id}
                href={`/deals/${encodeURIComponent(d.id)}/customer`}
                className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {d.customer_name ?? "(No name)"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {d.id}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {d.status ?? "unknown"}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}