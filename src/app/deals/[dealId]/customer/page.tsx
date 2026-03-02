import CustomerStepClient from "./CustomerStepClient";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  return <CustomerStepClient dealId={dealId} />;
}  