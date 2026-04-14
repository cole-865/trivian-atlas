import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { loadPrimaryCustomerNames } from "@/lib/deals/customerName";
import { getDealForCurrentOrganization } from "@/lib/deals/organizationScope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type PageProps = {
  params: Promise<{ dealId: string }>;
};

export default async function DealPage({ params }: PageProps) {
  const { dealId } = await params;
  const supabase = await createClient();

  const { data: deal, error, organizationId } = await getDealForCurrentOrganization<{
    id: string;
    customer_name: string | null;
    status: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>(
    supabase,
    dealId,
    "id, customer_name, status, created_at, updated_at"
  );

  if (error || !deal) {
    return (
      <Card className="border-destructive/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader>
          <CardTitle className="text-lg">Deal not found</CardTitle>
          <CardDescription>
            ID: <code className="rounded bg-background/50 px-1.5 py-0.5">{dealId}</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="secondary">
            <Link href="/home">Back to Home</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const primaryNames = await loadPrimaryCustomerNames(
    supabase,
    [dealId],
    organizationId
  );
  const customerName = primaryNames[dealId] ?? deal.customer_name ?? "(No name)";
  const updatedAt = deal.updated_at ?? deal.created_at;

  return (
    <div className="grid gap-6">
      <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary">
              Workflow
            </div>
            <CardTitle className="mt-1.5 text-xl">{customerName}</CardTitle>
            <CardDescription className="mt-1 text-sm text-muted-foreground/80">
              Deal ID: {deal.id}
            </CardDescription>
          </div>

          <Button asChild>
            <Link href={`/deals/${encodeURIComponent(deal.id)}/customer`}>
              Go to Step 1 (Customer)
            </Link>
          </Button>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
          <CardHeader className="pb-3">
            <CardDescription className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground/75">
              Status
            </CardDescription>
            <CardTitle className="text-lg">
              <Badge variant="secondary">{deal.status ?? "unknown"}</Badge>
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
          <CardHeader className="pb-3">
            <CardDescription className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground/75">
              Last updated
            </CardDescription>
            <CardTitle className="text-base">
              {updatedAt ? new Date(updatedAt).toLocaleString() : "-"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Steps</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm"><Link href={`/deals/${deal.id}/customer`}>Customer</Link></Button>
          <Button asChild variant="secondary" size="sm"><Link href={`/deals/${deal.id}/income`}>Income</Link></Button>
          <Button asChild variant="secondary" size="sm"><Link href={`/deals/${deal.id}/vehicle`}>Vehicle</Link></Button>
          <Button asChild variant="secondary" size="sm"><Link href={`/deals/${deal.id}/deal`}>Deal</Link></Button>
          <Button asChild variant="secondary" size="sm"><Link href={`/deals/${deal.id}/submit`}>Submit</Link></Button>
          <Button asChild variant="secondary" size="sm"><Link href={`/deals/${deal.id}/fund`}>Fund</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
