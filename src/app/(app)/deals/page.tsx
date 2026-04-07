import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { loadPrimaryCustomerNames } from "@/lib/deals/customerName";
import {
  getCurrentOrganizationIdForDeals,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";

type Props = {
  searchParams?: Promise<{ q?: string }>;
};

export default async function DealsPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const q = (sp.q ?? "").trim();

  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationIdForDeals(supabase);
  let data: Array<{
    id: string;
    customer_name: string | null;
    status: string | null;
    updated_at: string | null;
    created_at: string | null;
  }> | null = null;
  let error: { message?: string } | null = null;

  if (!organizationId) {
    error = { message: NO_CURRENT_ORGANIZATION_MESSAGE };
  }

  if (!error && q) {
    const [{ data: dealMatches, error: dealErr }, { data: personMatches, error: peopleErr }] =
      await Promise.all([
        supabase
          .from("deals")
          .select("id")
          .eq("organization_id", organizationId)
          .or(`customer_name.ilike.%${q}%,id::text.ilike.%${q}%`)
          .limit(50),
        supabase
          .from("deal_people")
          .select("deal_id")
          .eq("role", "primary")
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
          .limit(50),
      ]);

    error = dealErr ?? peopleErr;

    const matchedIds = Array.from(
      new Set([
        ...((dealMatches ?? []).map((row) => String(row.id))),
        ...((personMatches ?? []).map((row) => String(row.deal_id))),
      ])
    );

    if (!error && matchedIds.length) {
      const result = await supabase
        .from("deals")
        .select("id, customer_name, status, updated_at, created_at")
        .eq("organization_id", organizationId)
        .in("id", matchedIds)
        .order("updated_at", { ascending: false })
        .limit(50);

      data = result.data;
      error = result.error;
    } else if (!error) {
      data = [];
    }
  } else if (!error) {
    const result = await supabase
      .from("deals")
      .select("id, customer_name, status, updated_at, created_at")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(50);

    data = result.data;
    error = result.error;
  }

  if (error) {
    return (
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-lg font-semibold">Deals</div>
        <div className="mt-2 text-sm text-red-600">{error.message}</div>
      </div>
    );
  }

  const deals = data ?? [];
  const primaryNames = await loadPrimaryCustomerNames(
    supabase,
    deals.map((deal) => String(deal.id))
  );

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
                    {primaryNames[String(d.id)] ?? d.customer_name ?? "(No name)"}
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
