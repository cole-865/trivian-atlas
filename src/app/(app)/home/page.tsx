import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { loadPrimaryCustomerNames } from "@/lib/deals/customerName";
import { getCurrentOrganizationIdForDeals } from "@/lib/deals/organizationScope";

type DashboardMetrics = {
  deals_created_30d: number;
  deals_worked_30d: number;
  pending_approvals: number;
  risk_review_queue: number;
  vehicles_inventory: number;
  credit_reports_processing: number;
};

function StatCard({
  title,
  value,
  subtitle,
  href,
}: {
  title: string;
  value: string;
  subtitle?: string;
  href?: string;
}) {
  const card = (
    <div className="rounded-2xl border bg-white p-4 shadow-sm hover:shadow transition">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {subtitle ? (
        <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
      ) : null}
    </div>
  );

  return href ? <Link href={href}>{card}</Link> : card;
}

function statusBadge(statusRaw: string) {
  const status = (statusRaw || "unknown").toLowerCase();

  // simple “good enough” mapping for now
  const map: Record<
    string,
    { label: string; className: string }
  > = {
    draft: {
      label: "Draft",
      className: "bg-gray-100 text-gray-700 border-gray-200",
    },
    review: {
      label: "Review",
      className: "bg-yellow-50 text-yellow-800 border-yellow-200",
    },
    approved: {
      label: "Approved",
      className: "bg-green-50 text-green-800 border-green-200",
    },
    declined: {
      label: "Declined",
      className: "bg-red-50 text-red-800 border-red-200",
    },
    submitted: {
      label: "Submitted",
      className: "bg-blue-50 text-blue-800 border-blue-200",
    },
  };

  const chosen =
    map[status] ??
    ({
      label: statusRaw || "Unknown",
      className: "bg-gray-50 text-gray-700 border-gray-200",
    } as const);

  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        chosen.className,
      ].join(" ")}
    >
      {chosen.label}
    </span>
  );
}

function SectionCard({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{title}</div>
        <div className="shrink-0">{right}</div>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

async function getDashboardMetrics(): Promise<DashboardMetrics> {
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

  return {
    deals_created_30d: Number(data?.deals_created_30d ?? 0),
    deals_worked_30d: Number(data?.deals_worked_30d ?? 0),
    pending_approvals: Number(data?.pending_approvals ?? 0),
    risk_review_queue: Number(data?.risk_review_queue ?? 0),
    vehicles_inventory: Number(data?.vehicles_inventory ?? 0),
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
  const metrics = await getDashboardMetrics();
  const recentDeals = await getRecentDeals();

  return (
    <div className="space-y-6">
      {/* Page header (layout provides topbar; this is the page title block) */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">Home</div>
          <div className="text-xs text-muted-foreground">
            Last 30 days + current queues.
          </div>
        </div>

        <Link
          href="/deals/new"
          className="rounded-xl bg-black px-3 py-2 text-sm text-white hover:opacity-90"
        >
          New Deal
        </Link>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Deals created (30 days)"
          value={String(metrics.deals_created_30d)}
          subtitle="New deals entered Atlas"
          href="/deals?range=30d"
        />
        <StatCard
          title="Deals worked (30 days)"
          value={String(metrics.deals_worked_30d)}
          subtitle="Deals updated in last 30 days"
          href="/deals?range=30d&sort=updated"
        />
        <StatCard
          title="Pending approvals"
          value={String(metrics.pending_approvals)}
          subtitle="Needs a decision"
          href="/approvals"
        />
        <StatCard
          title="Vehicles in inventory"
          value={String(metrics.vehicles_inventory)}
          subtitle="Current inventory count"
          href="/inventory"
        />
      </div>

      {/* Second row: queues/alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard
          title="Risk review queue"
          right={
            <Link
              className="text-xs text-muted-foreground hover:underline"
              href="/approvals?filter=review"
            >
              View
            </Link>
          }
        >
          <div className="text-sm">
            <span className="font-semibold">{metrics.risk_review_queue}</span>{" "}
            deal(s) need manual review.
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            These are deals Atlas won’t auto-approve.
          </div>
        </SectionCard>

        <SectionCard
          title="Credit reports processing"
          right={
            <Link
              className="text-xs text-muted-foreground hover:underline"
              href="/credit-reports?filter=processing"
            >
              View
            </Link>
          }
        >
          <div className="text-sm">
            <span className="font-semibold">
              {metrics.credit_reports_processing}
            </span>{" "}
            job(s) in queue.
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            If this spikes, the parser pipeline is choking.
          </div>
        </SectionCard>
      </div>

      {/* Recent deals */}
      <SectionCard
        title="Recent deal activity"
        right={
          <Link
            className="text-xs text-muted-foreground hover:underline"
            href="/deals"
          >
            View all
          </Link>
        }
      >
        {recentDeals.length === 0 ? (
          <div className="text-sm text-muted-foreground">No deals found.</div>
        ) : (
          <div className="divide-y">
            {recentDeals.map((d) => (
              <Link
                key={d.id}
                // ✅ Avoid the 404 by linking to an existing step page
                href={`/deals/${encodeURIComponent(d.id)}/customer`}
                className="flex items-center justify-between gap-3 py-3 hover:bg-gray-50 rounded-xl px-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {d.customer_name}
                    </div>
                    {statusBadge(d.status)}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {d.id}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground shrink-0">
                  {timeAgo(d.updated_at)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
