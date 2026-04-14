import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
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
  searchParams?: Promise<{ q?: string }>;
};

function statusBadge(statusRaw: string | null) {
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

function formatUpdated(value: string | null) {
  if (!value) return "Unknown";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function DealsPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const q = (sp.q ?? "").trim();

  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationIdForDeals(supabase);
  let data: Array<{
    id: string;
    customer_name: string | null;
    status: string | null;
    updated_at: string | null;
    created_at: string | null;
  }> | null = null;
  let error: { message?: string } | null = null;

  if (!organizationId) {
    error = { message: NO_CURRENT_ORGANIZATION_MESSAGE };
  }

  if (!error && q) {
    const [{ data: dealMatches, error: dealErr }, { data: personMatches, error: peopleErr }] =
      await Promise.all([
        supabase
          .from("deals")
          .select("id")
          .eq("organization_id", organizationId)
          .or(`customer_name.ilike.%${q}%,id::text.ilike.%${q}%`)
          .limit(50),
        supabase
          .from("deal_people")
          .select("deal_id")
          .eq("organization_id", organizationId)
          .eq("role", "primary")
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
          .limit(50),
      ]);

    error = dealErr ?? peopleErr;

    const matchedIds = Array.from(
      new Set([
        ...((dealMatches ?? []).map((row) => String(row.id))),
        ...((personMatches ?? []).map((row) => String(row.deal_id))),
      ])
    );

    if (!error && matchedIds.length) {
      const result = await supabase
        .from("deals")
        .select("id, customer_name, status, updated_at, created_at")
        .eq("organization_id", organizationId)
        .in("id", matchedIds)
        .order("updated_at", { ascending: false })
        .limit(50);

      data = result.data;
      error = result.error;
    } else if (!error) {
      data = [];
    }
  } else if (!error) {
    const result = await supabase
      .from("deals")
      .select("id, customer_name, status, updated_at, created_at")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(50);

    data = result.data;
    error = result.error;
  }

  if (error) {
    return (
      <Card className="border-destructive/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader>
          <CardTitle className="text-lg">Deals</CardTitle>
          <CardDescription className="text-destructive">
            {error.message}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const deals = data ?? [];
  const primaryNames = await loadPrimaryCustomerNames(
    supabase,
    deals.map((deal) => String(deal.id)),
    organizationId
  );

  return (
    <div className="space-y-6">
      <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader className="gap-3 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary">
                Pipeline
              </div>
              <CardTitle className="mt-1.5 text-xl">Deals</CardTitle>
              <CardDescription className="mt-1 text-sm text-muted-foreground/80">
                {q ? `Search results for "${q}"` : "Most recently updated deals in the active account."}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {q ? <Badge variant="default">Filtered</Badge> : <Badge variant="secondary">Latest</Badge>}
              <Button asChild>
                <Link href="/deals/new">New Deal</Link>
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Deal list</CardTitle>
              <CardDescription className="mt-1 text-xs uppercase tracking-[0.08em] text-muted-foreground/75">
                Customer, status, and last activity
              </CardDescription>
            </div>
            <Search className="size-4 text-muted-foreground/70" />
          </div>
        </CardHeader>
        <CardContent>
          {deals.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 bg-background/30 px-4 py-10 text-sm text-muted-foreground/80">
              No deals found.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/75 bg-background/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Customer</TableHead>
                    <TableHead>Deal ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deals.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium text-foreground">
                        {primaryNames[String(d.id)] ?? d.customer_name ?? "(No name)"}
                      </TableCell>
                      <TableCell className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/75">
                        {d.id}
                      </TableCell>
                      <TableCell>{statusBadge(d.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground/80">
                        {formatUpdated(d.updated_at ?? d.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="secondary" size="sm">
                          <Link href={`/deals/${encodeURIComponent(d.id)}/customer`}>
                            Open
                            <ArrowUpRight />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
