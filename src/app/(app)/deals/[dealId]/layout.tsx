import { DealStepNav } from "@/components/DealStepNav";
import { supabaseServer } from "@/lib/supabase/server";

export default async function DealLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  const { data: uwResult } = await supabase
    .from("underwriting_results")
    .select("tier")
    .eq("deal_id", dealId)
    .eq("stage", "bureau_precheck")
    .maybeSingle();

  return (
    <div style={{ padding: 16, width: "100%", maxWidth: 1800, margin: "0 auto" }}>
      <DealStepNav dealId={dealId} tier={uwResult?.tier ?? null} />
      <div style={{ marginTop: 12, width: "100%" }}>{children}</div>
    </div>
  );
}