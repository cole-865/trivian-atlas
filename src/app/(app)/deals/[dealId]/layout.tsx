import { DealStepNav } from "@/components/DealStepNav";
import { supabaseServer } from "@/lib/supabase/server";
import { canAccessStep, type DealStep } from "@/lib/deals/canAccessStep";
import { loadPrimaryCustomerNames } from "@/lib/deals/customerName";
import { getDealForCurrentOrganization } from "@/lib/deals/organizationScope";
import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";
import { scopeDealStageQueryToOrganization } from "@/lib/deals/underwritingOrganizationScope";

export const dynamic = "force-dynamic";

export default async function DealLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  const { data: deal, error: dealError, organizationId } =
    await getDealForCurrentOrganization<{
    submit_status: string | null;
    submitted_at: string | null;
  }>(supabase, dealId, "submit_status, submitted_at");

  if (dealError) {
    console.error("[DealLayout deals]", {
      dealId,
      message: dealError.message,
    });
  }

  const { data: uwResult, error: uwError } = organizationId
    ? await scopeDealStageQueryToOrganization(
        supabase.from("underwriting_results").select("tier, decision"),
        organizationId,
        dealId,
        "bureau_precheck"
      ).maybeSingle()
    : { data: null, error: null };

  if (uwError) {
    console.error("[DealLayout underwriting_results]", {
      dealId,
      message: uwError.message,
    });
  }

  const { data: structure, error: structureError } = organizationId
    ? await scopeQueryToOrganization(
        supabase.from("deal_structure").select("vehicle_id"),
        organizationId
      )
        .eq("deal_id", dealId)
        .maybeSingle()
    : { data: null, error: null };

  if (structureError) {
    console.error("[DealLayout deal_structure]", {
      dealId,
      message: structureError.message,
    });
  }

  const primaryNames = organizationId
    ? await loadPrimaryCustomerNames(supabase, [dealId], organizationId)
    : {};
  const customerName = primaryNames[dealId] ?? null;

  const stepKeys: DealStep[] = [
    "customer",
    "income",
    "vehicle",
    "deal",
    "submit",
    "fund",
  ];

  const accessEntries = await Promise.all(
    stepKeys.map(async (step) => {
      const result = await canAccessStep({
        supabase,
        step,
        deal: {
          selected_vehicle_id: structure?.vehicle_id ?? null,
          submit_status: deal?.submit_status ?? null,
          submitted_at: deal?.submitted_at ?? null,
        },
        underwriting: {
          decision: uwResult?.decision ?? null,
        },
      });

      return [step, result.allowed] as const;
    })
  );

  const access = Object.fromEntries(accessEntries) as Partial<Record<DealStep, boolean>>;

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 py-4 sm:px-6">
      <DealStepNav
        dealId={dealId}
        customerName={customerName}
        tier={uwResult?.tier ?? null}
        access={access}
      />
      <div className="mt-4 w-full">{children}</div>
    </div>
  );
}
