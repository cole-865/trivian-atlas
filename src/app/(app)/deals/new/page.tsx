import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, SectionCard, NoticeBanner } from "@/components/atlas/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/utils/supabase/server";
import {
  getCurrentOrganizationIdForDeals,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";

async function createDeal(formData: FormData) {
  "use server";

  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const fallbackCustomerName = String(formData.get("customer_name") ?? "").trim();
  const customer_name = `${firstName} ${lastName}`.trim() || fallbackCustomerName;

  if (!customer_name) {
    redirect("/deals/new?error=Customer%20first%20and%20last%20name%20are%20required");
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
    <div className="max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Pipeline"
        title="New Deal"
        description="Enter the customer name to start a deal in the current organization."
      />

      <SectionCard
        title="Customer details"
        description="Atlas uses the customer name to seed the new deal shell before the workflow begins."
      >
        {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}

        <form action={createDeal} className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="first_name">First name</Label>
              <Input
                id="first_name"
                name="first_name"
                placeholder="e.g., Cole"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="last_name">Last name</Label>
              <Input
                id="last_name"
                name="last_name"
                placeholder="e.g., Hitchcox"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Button asChild variant="secondary">
              <Link href="/home">Cancel</Link>
            </Button>

            <Button type="submit">Create deal</Button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
