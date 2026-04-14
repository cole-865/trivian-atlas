import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import { loadPrimaryCustomerNames } from "@/lib/deals/customerName";
import { getCurrentOrganizationIdForDeals } from "@/lib/deals/organizationScope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

type DashboardMetrics = {
  deals_created_30d: number;
  deals_worked_30d: number;
  pending_approvals: number;
  risk_review_queue: number;
  vehicles_inventory: number;
  credit_reports_processing: number;
};

function formatMetric(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function StatCard({
  title,
  value,
  subtitle,
  href,
  tone = "default",
}: {
  title: string;
  value: number;
  subtitle?: string;
  href?: string;
  tone?: "default" | "primary" | "warning";
}) {
  const content = (
    <Card className="group h-full border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.22)] transition-colors hover:border-primary/35">
      <CardHeader className="gap-3 pb-1.5">
        <div className="flex items-start justify-between gap-3">
          <CardDescription className="text-[0.66rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground/72">
            {title}
          </CardDescription>
          {href ? (
            <ArrowUpRight className="mt-0.5 size-4 text-muted-foreground/75 transition-colors group-hover:text-primary" />
          ) : null}
        </div>
        <CardTitle
          className={[
            "text-[3.4rem] font-semibold tracking-[-0.05em] sm:text-[4rem]",
            tone === "primary"
              ? "text-primary"
              : tone === "warning"
                ? "text-warning"
                : "text-foreground",
          ].join(" ")}
        >
          {formatMetric(value)}
        </CardTitle>
      </CardHeader>
      {subtitle ? (
        <CardContent className="pt-0">
          <p className="text-[11px] text-muted-foreground/72">{subtitle}</p>
        </CardContent>
      ) : null}
    </Card>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {content}
    </Link>
  ) : (
    content
  );
}

function statusBadge(statusRaw: string) {
  const status = (statusRaw || "unknown").toLowerCase();

  const map: Record<
    string,
    { label: string; variant: "secondary" | "warning" | "success" | "destructive" | "default" }
  > = {
    draft: {
      label: "Draft",
      variant: "secondary",
    },
    review: {
      label: "Review",
      variant: "warning",
    },
    approved: {
      label: "Approved",
      variant: "success",
    },
    declined: {
      label: "Declined",
      variant: "destructive",
    },
    submitted: {
      label: "Submitted",
      variant: "default",
    },
  };

  const chosen = map[status] ?? {
    label: statusRaw || "Unknown",
    variant: "secondary" as const,
  };

  return <Badge variant={chosen.variant}>{chosen.label}</Badge>;
}

function SectionCard({
  eyebrow,
  title,
  children,
  right,
}: {
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
      <CardHeader className="gap-2 pb-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            {eyebrow ? (
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary">
                {eyebrow}
              </div>
            ) : null}
            <CardTitle className="mt-1.5 text-lg">{title}</CardTitle>
          </div>
          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

async function getDashboardMetrics(
  organizationId: string | null
): Promise<DashboardMetrics> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("atlas_dashboard_metrics");

  if (error) {
    console.error("atlas_dashboard_metrics error:", error);
    return {
      deals_created_30d: 0,
      deals_worked_30d: 0,
      pending_approvals: 0,
      risk_review_queue: 0,
      vehicles_inventory: 0,
      credit_reports_processing: 0,
    };
  }

  let vehiclesInventory = Number(data?.vehicles_inventory ?? 0);

  if (organizationId) {
    const inventoryResponse = await supabase
      .from("trivian_inventory")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "IN INVENTORY");

    if (inventoryResponse.error) {
      console.error("inventory metrics error:", inventoryResponse.error);
    } else {
      vehiclesInventory = Number(inventoryResponse.count ?? 0);
    }
  }

  return {
    deals_created_30d: Number(data?.deals_created_30d ?? 0),
    deals_worked_30d: Number(data?.deals_worked_30d ?? 0),
    pending_approvals: Number(data?.pending_approvals ?? 0),
    risk_review_queue: Number(data?.risk_review_queue ?? 0),
    vehicles_inventory: vehiclesInventory,
    credit_reports_processing: Number(data?.credit_reports_processing ?? 0),
  };
}

async function getRecentDeals() {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationIdForDeals(supabase);

  if (!organizationId) {
    return [];
  }

  const { data, error } = await supabase
    .from("deals")
    .select("id, customer_name, status, updated_at, created_at")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("recent deals error:", error);
    return [];
  }

  const rows = data ?? [];
  const primaryNames = await loadPrimaryCustomerNames(
    supabase,
    rows.map((deal) => String(deal.id)),
    organizationId
  );

  return rows.map((d) => ({
    id: String(d.id),
    customer_name: primaryNames[String(d.id)] ?? d.customer_name ?? "(No name)",
    status: d.status ?? "unknown",
    updated_at: d.updated_at ?? d.created_at,
  }));
}

function timeAgo(ts: string | null) {
  if (!ts) return "";
  const d = new Date(ts).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Date.now() - d;

  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;

  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default async function HomePage() {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationIdForDeals(supabase);
  const metrics = await getDashboardMetrics(organizationId);
  const recentDeals = await getRecentDeals();

  return (
    <div className="space-y-6">
      <SectionCard
        eyebrow="Overview"
        title="Home"
        right={
          <Button asChild size="lg" className="shadow-[0_0_24px_rgba(0,190,255,0.18)]">
            <Link href="/deals/new">
              <Plus />
              New Deal
            </Link>
          </Button>
        }
      >
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
          <div>
            <p className="text-sm text-muted-foreground/85">
              Last 30 days and current operational queues for the active account.
            </p>
          </div>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border/75 bg-background/45 px-4 py-1.5">
              <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground/76">Pending approvals</span>
              <span className="text-lg font-semibold text-warning">
                {formatMetric(metrics.pending_approvals)}
              </span>
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Deals created (30 days)"
          value={metrics.deals_created_30d}
          subtitle="New deals entered Atlas"
          href="/deals?range=30d"
        />
        <StatCard
          title="Deals worked (30 days)"
          value={metrics.deals_worked_30d}
          subtitle="Deals updated in last 30 days"
          href="/deals?range=30d&sort=updated"
          tone="primary"
        />
        <StatCard
          title="Pending approvals"
          value={metrics.pending_approvals}
          subtitle="Needs a decision"
          href="/approvals"
          tone="warning"
        />
        <StatCard
          title="Vehicles in inventory"
          value={metrics.vehicles_inventory}
          subtitle="Current inventory count"
          href="/inventory"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard
          eyebrow="Queue"
          title="Risk review queue"
          right={
            <Button asChild variant="secondary" size="sm">
              <Link href="/approvals?filter=review">View</Link>
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-5xl font-semibold tracking-[-0.04em] text-warning">
                  {formatMetric(metrics.risk_review_queue)}
                </div>
                <div className="mt-1.5 text-sm text-foreground">
                  deal(s) currently need manual review.
                </div>
              </div>
              <Badge variant="warning">Manual review</Badge>
            </div>
            <Separator />
            <p className="text-xs text-muted-foreground/80">
              These are deals Atlas won’t auto-approve.
            </p>
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Pipeline"
          title="Credit reports processing"
          right={
            <Button asChild variant="secondary" size="sm">
              <Link href="/credit-reports?filter=processing">View</Link>
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-5xl font-semibold tracking-[-0.04em] text-primary">
                  {formatMetric(metrics.credit_reports_processing)}
                </div>
                <div className="mt-1.5 text-sm text-foreground">
                  job(s) currently in queue.
                </div>
              </div>
              <Badge variant="default">Active</Badge>
            </div>
            <Separator />
            <p className="text-xs text-muted-foreground/80">
              If this spikes, the parser pipeline is choking.
            </p>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        eyebrow="Activity"
        title="Recent deal activity"
        right={
          <Button asChild variant="secondary" size="sm">
            <Link href="/deals">View all</Link>
          </Button>
        }
      >
        {recentDeals.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/80 bg-background/30 px-4 py-8 text-sm text-muted-foreground/85">
            No deals found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/75 bg-background/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            {recentDeals.map((d, index) => (
              <div key={d.id}>
                <Link
                  href={`/deals/${encodeURIComponent(d.id)}/customer`}
                  className="flex items-center justify-between gap-4 px-4 py-4.5 transition-colors hover:bg-accent/55"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-medium text-foreground">
                        {d.customer_name}
                      </div>
                      {statusBadge(d.status)}
                    </div>
                    <div className="mt-1 truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/75">
                      {d.id}
                    </div>
                  </div>

                  <div className="shrink-0 text-[11px] font-medium text-muted-foreground/70">
                    {timeAgo(d.updated_at)}
                  </div>
                </Link>
                {index < recentDeals.length - 1 ? <Separator /> : null}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
