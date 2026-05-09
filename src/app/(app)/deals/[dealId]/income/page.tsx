import IncomeStepClient from "./IncomeStepClient";
import { supabaseServer } from "@/lib/supabase/server";
import { getDealForCurrentOrganization } from "@/lib/deals/organizationScope";
import {
  DEFAULT_INCOME_VERIFICATION_SETTINGS,
  getIncomeVerificationSettingsForOrganization,
} from "@/lib/settings/dealershipSettings";

export default async function IncomePage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  const dealLookup = await getDealForCurrentOrganization<{
    id: string;
    household_income: boolean | null;
  }>(supabase, dealId, "id, household_income");
  const deal = dealLookup.data;
  const incomeVerificationSettings = dealLookup.organizationId
    ? await getIncomeVerificationSettingsForOrganization(dealLookup.organizationId).catch(
        () => DEFAULT_INCOME_VERIFICATION_SETTINGS
      )
    : DEFAULT_INCOME_VERIFICATION_SETTINGS;

  return (
    <IncomeStepClient
      dealId={dealId}
      initialHouseholdIncome={!!deal?.household_income}
      ytdCurrentCheckWarningThresholdPercent={
        incomeVerificationSettings.ytdCurrentCheckWarningThresholdPercent
      }
    />
  );
}
