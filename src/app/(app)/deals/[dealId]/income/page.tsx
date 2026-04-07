import IncomeStepClient from "./IncomeStepClient";
import { supabaseServer } from "@/lib/supabase/server";
import { getDealForCurrentOrganization } from "@/lib/deals/organizationScope";

export default async function IncomePage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  const { data: deal } = await getDealForCurrentOrganization<{
    id: string;
    household_income: boolean | null;
  }>(supabase, dealId, "id, household_income");

  return (
    <IncomeStepClient
      dealId={dealId}
      initialHouseholdIncome={!!deal?.household_income}
    />
  );
}
