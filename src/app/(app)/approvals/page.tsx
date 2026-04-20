import Link from "next/link";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";
import { loadPrimaryCustomerNames } from "@/lib/deals/customerName";
import {
  getCurrentOrganizationIdForDeals,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Props = {
  searchParams?: Promise<{ filter?: string }>;
};

type OverrideRequestRow = {
  id: string;
  deal_id: string;
  blocker_code: string;
  requested_at: string;
  requested_note: string | null;
  status: string;
};

type DealRow = {
  id: string;
  customer_name: string | null;
  status: string | null;
};

function formatRequestedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBlockerCode(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function dealStatusBadge(statusRaw: string | null) {
  const status = (statusRaw || "unknown").toLowerCase();

  const map: Record<
    string,
    { label: string; variant: "secondary" | "warning" | "success" | "destructive" | "default" }
  > = {
    draft: { label: "Draft", variant: "secondary" },
    review: { label: "Review", variant: "warning" },
    approved: { label: "Approved", variant: "success" },
    declined: { label: "Declined", variant: "destructive" },
    submitted: { label: "Submitted", variant: "default" },
  };

  const chosen = map[status] ?? {
    label: statusRaw || "Unknown",
    variant: "secondary" as const,
  };

  return <Badge variant={chosen.variant}>{chosen.label}</Badge>;
}

export default async function ApprovalsPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const filter = (sp.filter ?? "").trim().toLowerCase();
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationIdForDeals(supabase);

  if (!organizationId) {
    return (
      <Card className="border-destructive/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader>
          <CardTitle className="text-lg">Approvals</CardTitle>
          <CardDescription className="text-destructive">
            {NO_CURRENT_ORGANIZATION_MESSAGE}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const overridesResponse = await scopeQueryToOrganization(
    supabase
      .from("deal_override_requests")
      .select("id, deal_id, blocker_code, requested_at, requested_note, status"),
    organizationId
  )
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

  if (overridesResponse.error) {
    return (
      <Card className="border-destructive/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader>
          <CardTitle className="text-lg">Approvals</CardTitle>
          <CardDescription className="text-destructive">
            {overridesResponse.error.message}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const requests = (overridesResponse.data ?? []) as OverrideRequestRow[];
  const dealIds = Array.from(new Set(requests.map((request) => request.deal_id)));

  const dealsResponse = dealIds.length
    ? await supabase
        .from("deals")
        .select("id, customer_name, status")
        .eq("organization_id", organizationId)
        .in("id", dealIds)
    : { data: [] satisfies DealRow[], error: null };

  if (dealsResponse.error) {
    return (
      <Card className="border-destructive/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader>
          <CardTitle className="text-lg">Approvals</CardTitle>
          <CardDescription className="text-destructive">
            {dealsResponse.error.message}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const dealsById = new Map(
    ((dealsResponse.data ?? []) as DealRow[]).map((deal) => [deal.id, deal])
  );
  const primaryNames = await loadPrimaryCustomerNames(supabase, dealIds, organizationId);
  const isRiskReviewFilter = filter === "review";

  return (
    <div className="space-y-6">
      <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader className="gap-3 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary">
                Queue
              </div>
              <CardTitle className="mt-1.5 text-xl">
                {isRiskReviewFilter ? "Risk review queue" : "Approvals"}
              </CardTitle>
              <CardDescription className="mt-1 text-sm text-muted-foreground/80">
                Pending override requests for the active account.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="warning">Manual review</Badge>
              <Badge variant="secondary">{requests.length} open</Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Pending review</CardTitle>
              <CardDescription className="mt-1 text-xs uppercase tracking-[0.08em] text-muted-foreground/75">
                Override requests awaiting a decision
              </CardDescription>
            </div>
            <ShieldAlert className="size-4 text-warning" />
          </div>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 bg-background/30 px-4 py-10 text-sm text-muted-foreground/80">
              No pending approvals in this account.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/75 bg-background/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Customer</TableHead>
                    <TableHead>Blocker</TableHead>
                    <TableHead>Deal status</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Request note</TableHead>
                    <TableHead className="text-right">Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => {
                    const deal = dealsById.get(request.deal_id);
                    const customerName =
                      primaryNames[request.deal_id] ??
                      deal?.customer_name ??
                      "(No name)";

                    return (
                      <TableRow key={request.id}>
                        <TableCell className="font-medium text-foreground">
                          <div>{customerName}</div>
                          <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/75">
                            {request.deal_id}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="warning">
                            {formatBlockerCode(request.blocker_code)}
                          </Badge>
                        </TableCell>
                        <TableCell>{dealStatusBadge(deal?.status ?? null)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground/80">
                          {formatRequestedAt(request.requested_at)}
                        </TableCell>
                        <TableCell className="max-w-[24rem] text-sm text-muted-foreground/80">
                          <span className="line-clamp-2">
                            {request.requested_note?.trim() || "No note provided."}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="secondary" size="sm">
                            <Link href={`/deals/${encodeURIComponent(request.deal_id)}/deal`}>
                              Review
                              <ArrowUpRight />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
