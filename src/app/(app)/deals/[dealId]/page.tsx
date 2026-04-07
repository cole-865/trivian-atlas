import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { loadPrimaryCustomerNames } from "@/lib/deals/customerName";
import { getDealForCurrentOrganization } from "@/lib/deals/organizationScope";

type PageProps = {
  params: Promise<{ dealId: string }>;
};

export default async function DealPage({ params }: PageProps) {
  const { dealId } = await params;
  const supabase = await createClient();

  const { data: deal, error, organizationId } = await getDealForCurrentOrganization<{
    id: string;
    customer_name: string | null;
    status: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>(
    supabase,
    dealId,
    "id, customer_name, status, created_at, updated_at"
  );

  if (error || !deal) {
    return (
      <div className="p-6">
        <div className="text-lg font-semibold">Deal not found</div>
        <div className="mt-2 text-sm text-muted-foreground">
          ID: <code className="rounded bg-gray-100 px-1">{dealId}</code>
        </div>
        <div className="mt-4">
          <Link className="text-sm underline" href="/home">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const primaryNames = await loadPrimaryCustomerNames(
    supabase,
    [dealId],
    organizationId
  );
  const customerName = primaryNames[dealId] ?? deal.customer_name ?? "(No name)";
  const updatedAt = deal.updated_at ?? deal.created_at;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold">{customerName}</div>
          <div className="text-xs text-muted-foreground">Deal ID: {deal.id}</div>
        </div>

        <Link
          href={`/deals/${encodeURIComponent(deal.id)}/customer`}
          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        >
          Go to Step 1 (Customer)
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm text-muted-foreground">Status</div>
          <div className="mt-2 text-lg font-semibold">{deal.status ?? "unknown"}</div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm text-muted-foreground">Last updated</div>
          <div className="mt-2 text-sm">
            {updatedAt ? new Date(updatedAt).toLocaleString() : "-"}
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-medium">Steps</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/deals/${deal.id}/customer`}>Customer</Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/deals/${deal.id}/income`}>Income</Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/deals/${deal.id}/vehicle`}>Vehicle</Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/deals/${deal.id}/deal`}>Deal</Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/deals/${deal.id}/submit`}>Submit</Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/deals/${deal.id}/fund`}>Fund</Link>
        </div>
      </div>
    </div>
  );
}
