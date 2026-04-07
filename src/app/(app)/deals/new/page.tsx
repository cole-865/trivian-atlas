import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  getCurrentOrganizationIdForDeals,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";

async function createDeal(formData: FormData) {
  "use server";

  const customer_name = String(formData.get("customer_name") ?? "").trim();

  if (!customer_name) {
    redirect("/deals/new?error=Customer%20name%20is%20required");
  }

  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationIdForDeals(supabase);

  if (!organizationId) {
    const msg = encodeURIComponent(NO_CURRENT_ORGANIZATION_MESSAGE);
    redirect(`/deals/new?error=${msg}`);
  }

  const { data, error } = await supabase.rpc("create_deal_with_seed_data", {
    p_customer_name: customer_name,
    p_organization_id: organizationId,
  });

  if (error || !data?.length) {
    const msg = encodeURIComponent(error?.message ?? "Failed to create deal");
    redirect(`/deals/new?error=${msg}`);
  }

  redirect(`/deals/${encodeURIComponent(data[0].deal_id)}/customer`);
}

export default async function NewDealPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const error = sp.error ? decodeURIComponent(sp.error) : null;

  return (
    <div className="max-w-xl">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-xl font-semibold">New Deal</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Enter a customer name to start a deal.
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <form action={createDeal} className="mt-5 space-y-4">
          <div>
            <label className="text-sm font-medium">Customer name</label>
            <input
              name="customer_name"
              placeholder="e.g., Cole Hitchcox"
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-between">
            <Link
              href="/home"
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Cancel
            </Link>

            <button
              type="submit"
              className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:opacity-90"
            >
              Create deal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
