import IncomeStepClient from "./IncomeStepClient";
import { supabaseServer } from "@/lib/supabase/server";

export default async function IncomePage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  const { data: deal } = await supabase
    .from("deals")
    .select("id, household_income")
    .eq("id", dealId)
    .maybeSingle();

  return (
    <IncomeStepClient
      dealId={dealId}
      initialHouseholdIncome={!!deal?.household_income}
    />
  );
}