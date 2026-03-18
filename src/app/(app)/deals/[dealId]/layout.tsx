import { DealStepNav } from "@/components/DealStepNav";
import { supabaseServer } from "@/lib/supabase/server";

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
    .select("tier")
    .eq("deal_id", dealId)
    .eq("stage", "bureau_precheck")
    .maybeSingle();

  if (uwError) {
    console.error("[DealLayout underwriting_results]", {
      dealId,
      message: uwError.message,
    });
  }

  return (
    <div style={{ padding: 16, width: "100%", maxWidth: 1800, margin: "0 auto" }}>
      <DealStepNav dealId={dealId} tier={uwResult?.tier ?? null} />
      <div style={{ marginTop: 12, width: "100%" }}>{children}</div>
    </div>
  );
}