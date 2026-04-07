import { DealStepNav } from "@/components/DealStepNav";
import { supabaseServer } from "@/lib/supabase/server";
import { canAccessStep, type DealStep } from "@/lib/deals/canAccessStep";

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

  const { data: uwResult, error: uwError } = await supabase
    .from("underwriting_results")
    .select("tier, decision")
    .eq("deal_id", dealId)
    .eq("stage", "bureau_precheck")
    .maybeSingle();

  if (uwError) {
    console.error("[DealLayout underwriting_results]", {
      dealId,
      message: uwError.message,
    });
  }

  const { data: structure, error: structureError } = await supabase
    .from("deal_structure")
    .select("vehicle_id")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (structureError) {
    console.error("[DealLayout deal_structure]", {
      dealId,
      message: structureError.message,
    });
  }

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select("submit_status, submitted_at")
    .eq("id", dealId)
    .maybeSingle();

  if (dealError) {
    console.error("[DealLayout deals]", {
      dealId,
      message: dealError.message,
    });
  }

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
    <div style={{ padding: 16, width: "100%", maxWidth: 1800, margin: "0 auto" }}>
      <DealStepNav dealId={dealId} tier={uwResult?.tier ?? null} access={access} />
      <div style={{ marginTop: 12, width: "100%" }}>{children}</div>
    </div>
  );
}
