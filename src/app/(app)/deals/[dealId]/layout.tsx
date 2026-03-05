import { DealStepNav } from "@/components/DealStepNav";

export default async function DealLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <DealStepNav dealId={dealId} />
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}