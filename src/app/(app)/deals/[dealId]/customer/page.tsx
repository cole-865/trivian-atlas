import CustomerStepClient from "./CustomerStepClient";
import { supabaseServer } from "@/lib/supabase/server";
import { getDealForCurrentOrganization } from "@/lib/deals/organizationScope";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const supabase = await supabaseServer();
  const { data: deal } = await getDealForCurrentOrganization<{
    id: string;
    customer_name: string | null;
  }>(supabase, dealId, "id, customer_name");

  return (
    <CustomerStepClient
      dealId={dealId}
      initialCustomerName={deal?.customer_name ?? null}
    />
  );
}  
