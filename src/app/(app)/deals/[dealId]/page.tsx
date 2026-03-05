import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

type PageProps = {
  params: Promise<{ dealId: string }>;
};

export default async function DealPage({ params }: PageProps) {
  const { dealId } = await params;
  const supabase = await createClient();

  const { data: deal, error } = await supabase
    .from("deals")
    .select("id, customer_name, status, created_at, updated_at")
    .eq("id", dealId)
    .single();

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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold">{deal.customer_name}</div>
          <div className="text-xs text-muted-foreground">
            Deal ID: {deal.id}
          </div>
        </div>

        <Link
          href={`/deals/${encodeURIComponent(deal.id)}/people`}
          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        >
          Go to Step 1 (People)
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
            {(deal.updated_at ?? deal.created_at) ? new Date(deal.updated_at ?? deal.created_at).toLocaleString() : "—"}
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-medium">Steps</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/deals/${deal.id}/people`}>People</Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/deals/${deal.id}/income`}>Income</Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/deals/${deal.id}/vehicle-selection`}>Vehicle</Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/deals/${deal.id}/documents`}>Documents</Link>
        </div>
      </div>
    </div>
  );
}