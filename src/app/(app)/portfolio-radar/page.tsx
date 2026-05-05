import Link from "next/link";
import { Radar, Search } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import { getAuthContext } from "@/lib/auth/userRole";
import type { Tables } from "@/lib/supabase/database.generated";
import { EmptyState, NoticeBanner, PageHeader, SectionCard } from "@/components/atlas/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type RepoSignal = Tables<"account_repo_signals"> & { customer_name: string | null };
type CollectionsSignal = Tables<"account_collections_signals">;
type PaymentSignal = Tables<"account_payment_signals"> & { scheduled_payment_amount: number | null };
type OutcomeSignal = Tables<"account_outcomes">;
type ImportStatus = Pick<
  Tables<"dms_import_batches">,
  "report_type" | "source_filename" | "imported_at" | "row_count" | "status"
>;

type TabKey = "action" | "repo" | "collections" | "payments" | "outcomes" | "imports";

type SearchParams = {
  tab?: string;
  recommended_status?: string;
  collections_tier?: string;
  outcome_bucket?: string;
  q?: string;
  repo_now?: string;
  pre_repo?: string;
  watch?: string;
  deal?: string;
};

type Props = {
  searchParams?: Promise<SearchParams>;
};

type ActionRow = {
  repo: RepoSignal;
  collections: CollectionsSignal | null;
  payment: PaymentSignal | null;
  outcome: OutcomeSignal | null;
  urgencyScore: number;
  priority: "Repo Now" | "Pre-Repo" | "Watch" | "Monitor";
  keyFlags: string[];
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "action", label: "Action List" },
  { key: "repo", label: "Repo Radar" },
  { key: "collections", label: "Collections" },
  { key: "payments", label: "Payments" },
  { key: "outcomes", label: "Outcomes" },
  { key: "imports", label: "Imports" },
];

const REPORT_LABELS: Record<string, string> = {
  all_accounts: "All Accounts",
  payment_ledger: "Payment Ledger",
  bhph_activities: "Activities",
};

const FLAG_LABELS: Record<string, string> = {
  days_past_due: "Past due",
  low_60_day_payment_ratio: "Low payment ratio",
  fragmented_payments: "Fragmented payments",
  survival_payments: "Survival payments",
  recent_reversals: "Recent reversals",
  stale_payment: "Stale payment",
  repo_activity_present: "Repo activity",
  insurance_or_collateral_issue: "Insurance/collateral issue",
  past_due_broken_or_stale_promise: "Broken/stale promise",
  early_default: "Early default",
};

function param(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || undefined;
}

function boolParam(value: string | undefined) {
  return value === "1" || value === "true" || value === "on";
}

function currentTab(value: string | undefined): TabKey {
  return TABS.some((tab) => tab.key === value) ? (value as TabKey) : "action";
}

function numberValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatNumber(value: number | null | undefined) {
  const parsed = numberValue(value);
  return parsed === null ? "n/a" : new Intl.NumberFormat("en-US").format(parsed);
}

function formatMoney(value: number | null | undefined) {
  const parsed = numberValue(value);
  return parsed === null
    ? "n/a"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(parsed);
}

function formatPercent(value: number | null | undefined) {
  const parsed = numberValue(value);
  if (parsed === null) return "n/a";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(parsed * 100)}%`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusBadge(value: string | null | undefined) {
  const normalized = (value ?? "Unknown").toUpperCase();
  const variant =
    normalized.includes("REPO") || normalized.includes("BAD") || normalized.includes("HIGH")
      ? "destructive"
      : normalized.includes("WATCH") || normalized.includes("ELEVATED")
        ? "warning"
        : normalized.includes("STABLE") || normalized.includes("GOOD")
          ? "success"
          : "secondary";

  return <Badge variant={variant}>{value ?? "Unknown"}</Badge>;
}

function humanFlag(flag: string) {
  return FLAG_LABELS[flag] ?? flag.replaceAll("_", " ");
}

function flagBadges(flags: string[] | null | undefined, max = 3) {
  if (!flags?.length) return <span className="text-muted-foreground/70">None</span>;
  const uniqueFlags = Array.from(new Set(flags.filter(Boolean)));

  return (
    <div className="flex max-w-[18rem] flex-wrap gap-1">
      {uniqueFlags.slice(0, max).map((flag) => (
        <Badge key={flag} variant="warning" className="normal-case tracking-normal">
          {humanFlag(flag)}
        </Badge>
      ))}
      {uniqueFlags.length > max ? <Badge variant="outline">+{uniqueFlags.length - max}</Badge> : null}
    </div>
  );
}

function AccountCell({
  dealNumber,
  customerName,
}: {
  dealNumber: string | null | undefined;
  customerName?: string | null;
}) {
  return (
    <div className="min-w-[9rem]">
      <div className="font-medium text-foreground">{customerName || "Unknown customer"}</div>
      <div className="text-xs text-muted-foreground/75">Deal {dealNumber ?? "n/a"}</div>
    </div>
  );
}

function metric(label: string, value: string | number, tone: "default" | "warning" | "danger" = "default") {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning"
        : "text-foreground";

  return (
    <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))]">
      <CardHeader className="px-4 pb-1.5 pt-3">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function queryWith(base: SearchParams, updates: Partial<SearchParams>) {
  const params = new URLSearchParams();
  const next = { ...base, ...updates };
  for (const [key, value] of Object.entries(next)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/portfolio-radar?${query}` : "/portfolio-radar";
}

function detailHref(sp: SearchParams, dealNumber: string) {
  return queryWith(sp, { deal: dealNumber });
}

function priorityBadge(priority: ActionRow["priority"]) {
  const variant =
    priority === "Repo Now"
      ? "destructive"
      : priority === "Pre-Repo" || priority === "Watch"
        ? "warning"
        : "secondary";
  return <Badge variant={variant}>{priority}</Badge>;
}

function Filters({ sp }: { sp: SearchParams }) {
  return (
    <form className="grid gap-2 rounded-xl border border-border/75 bg-background/25 p-3 lg:grid-cols-[minmax(160px,1fr)_160px_170px_160px_auto]">
      <input type="hidden" name="tab" value={currentTab(sp.tab)} />
      {sp.deal ? <input type="hidden" name="deal" value={sp.deal} /> : null}
      <Input name="q" defaultValue={sp.q ?? ""} placeholder="Deal number" className="h-9" />
      <NativeSelect name="recommended_status" defaultValue={sp.recommended_status ?? ""} className="h-9">
        <option value="">All repo statuses</option>
        <option value="REPO NOW">Repo Now</option>
        <option value="PRE-REPO">Pre-Repo</option>
        <option value="WATCH">Watch</option>
        <option value="STABLE">Stable</option>
      </NativeSelect>
      <NativeSelect name="collections_tier" defaultValue={sp.collections_tier ?? ""} className="h-9">
        <option value="">All collections tiers</option>
        <option value="HIGH EFFORT / PROBLEM">High Effort / Problem</option>
        <option value="ELEVATED EFFORT">Elevated Effort</option>
        <option value="WATCH">Watch</option>
        <option value="NORMAL">Normal</option>
      </NativeSelect>
      <NativeSelect name="outcome_bucket" defaultValue={sp.outcome_bucket ?? ""} className="h-9">
        <option value="">All outcomes</option>
        <option value="Good / Performing">Good / Performing</option>
        <option value="Watch / Neutral">Watch / Neutral</option>
        <option value="Bad Outcome">Bad Outcome</option>
        <option value="Excluded">Excluded</option>
      </NativeSelect>
      <Button type="submit" size="sm" className="gap-2">
        <Search className="size-4" />
        Filter
      </Button>
      <div className="flex flex-wrap gap-3 lg:col-span-5">
        {[
          ["repo_now", "Repo Now"],
          ["pre_repo", "Pre-Repo"],
          ["watch", "Watch"],
        ].map(([name, label]) => (
          <label key={name} className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              name={name}
              value="1"
              defaultChecked={boolParam(sp[name as keyof SearchParams])}
              className="size-3.5 rounded border-border bg-input"
            />
            {label}
          </label>
        ))}
      </div>
    </form>
  );
}

function TabNav({ active, sp }: { active: TabKey; sp: SearchParams }) {
  return (
    <div className="sticky top-[4.5rem] z-20 overflow-x-auto rounded-xl border border-border/75 bg-background/85 p-1 backdrop-blur-xl">
      <div className="flex min-w-max gap-1">
        {TABS.map((tab) => (
          <Button
            key={tab.key}
            asChild
            variant={active === tab.key ? "default" : "ghost"}
            size="sm"
            className="shrink-0"
          >
            <Link href={queryWith(sp, { tab: tab.key })}>{tab.label}</Link>
          </Button>
        ))}
      </div>
    </div>
  );
}

function RecentImportsCompact({ imports }: { imports: ImportStatus[] }) {
  const latest = imports[0];
  return (
    <details className="rounded-xl border border-border/75 bg-background/25 px-4 py-3">
      <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
        Recent import status
        {latest ? (
          <span className="ml-2 text-xs font-normal text-muted-foreground/75">
            Latest {REPORT_LABELS[latest.report_type] ?? latest.report_type}: {formatDateTime(latest.imported_at)}
          </span>
        ) : null}
      </summary>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {imports.slice(0, 3).map((item) => (
          <div
            key={`${item.report_type}:${item.imported_at}:${item.source_filename}`}
            className="rounded-lg border border-border/70 bg-background/25 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">
                {REPORT_LABELS[item.report_type] ?? item.report_type}
              </div>
              {statusBadge(item.status)}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground/75">
              {item.source_filename ?? "No filename"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground/75">
              {formatNumber(item.row_count)} rows · {formatDateTime(item.imported_at)}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function ImportsTab({ imports }: { imports: ImportStatus[] }) {
  return (
    <SectionCard title="Imports" description="Last 10 portfolio data loads.">
      <CompactTable emptyTitle="No recent imports" emptyDescription="No import batches were found.">
        {imports.map((item) => (
          <TableRow key={`${item.report_type}:${item.imported_at}:${item.source_filename}`}>
            <TableCell>{REPORT_LABELS[item.report_type] ?? item.report_type}</TableCell>
            <TableCell className="max-w-[22rem] truncate">{item.source_filename ?? "n/a"}</TableCell>
            <TableCell>{formatDateTime(item.imported_at)}</TableCell>
            <TableCell>{formatNumber(item.row_count)}</TableCell>
            <TableCell>{statusBadge(item.status)}</TableCell>
          </TableRow>
        ))}
      </CompactTable>
    </SectionCard>
  );
}

function CompactTable({
  children,
  emptyTitle,
  emptyDescription,
  heads,
}: {
  children: React.ReactNode[];
  emptyTitle: string;
  emptyDescription: string;
  heads?: string[];
}) {
  const rows = Array.isArray(children) ? children : [];
  if (!rows.length) {
    return <EmptyState className="min-h-28" title={emptyTitle} description={emptyDescription} />;
  }

  const headings = heads ?? ["Report", "Filename", "Imported", "Rows", "Status"];
  return (
    <div className="overflow-hidden rounded-xl border border-border/75 bg-background/25">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {headings.map((head) => (
              <TableHead key={head} className="h-9 px-3 text-[11px]">
                {head}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{rows}</TableBody>
      </Table>
    </div>
  );
}

function isOperationalActiveRepo(repo: Pick<RepoSignal, "repo_status">) {
  return !/reposses|repossess/i.test(repo.repo_status ?? "");
}

function buildActionRows(args: {
  repos: RepoSignal[];
  collectionsByDeal: Map<string, CollectionsSignal>;
  paymentsByDeal: Map<string, PaymentSignal>;
  outcomesByDeal: Map<string, OutcomeSignal>;
}) {
  return args.repos
    .map<ActionRow>((repo) => {
      const deal = repo.deal_number ?? "";
      const collections = args.collectionsByDeal.get(deal) ?? null;
      const payment = args.paymentsByDeal.get(deal) ?? null;
      const outcome = args.outcomesByDeal.get(deal) ?? null;
      const repoScore = repo.repo_score ?? 0;
      const priority = repo.repo_now
        ? "Repo Now"
        : repo.pre_repo
          ? "Pre-Repo"
          : repo.watch
            ? "Watch"
            : "Monitor";
      const priorityScore =
        priority === "Repo Now" ? 3000 : priority === "Pre-Repo" ? 2000 : priority === "Watch" ? 1000 : 0;
      const boosts =
        (collections?.collections_effort_score ?? 0) >= 50 ? 150 : 0;
      const urgencyScore =
        priorityScore +
        repoScore +
        boosts +
        ((repo.days_since_last_payment ?? payment?.days_since_last_payment ?? 0) >= 21 ? 120 : 0) +
        ((repo.reversals_60d ?? payment?.reversals_60d ?? 0) > 0 ? 90 : 0) +
        (payment?.survival_payment_flag ? 80 : 0) +
        (outcome?.is_bad_outcome ? 200 : 0);
      const keyFlags = [
        ...(repo.risk_flags ?? []),
        payment?.survival_payment_flag ? "survival_payments" : null,
        payment?.fragmented_payment_flag ? "fragmented_payments" : null,
        outcome?.is_bad_outcome ? "bad_outcome" : null,
      ].filter((flag): flag is string => !!flag);

      return { repo, collections, payment, outcome, urgencyScore, priority, keyFlags };
    })
    .sort((a, b) => b.urgencyScore - a.urgencyScore)
    .slice(0, 25);
}

function ActionList({ rows, sp }: { rows: ActionRow[]; sp: SearchParams }) {
  return (
    <SectionCard title="Action List" description="Top 25 accounts needing attention.">
      <CompactTable
        emptyTitle="No action accounts found"
        emptyDescription="No accounts matched the current filters."
        heads={[
          "Account",
          "Priority",
          "Repo Score",
          "DPD",
          "Last Pay",
          "60D Ratio",
          "Collections",
          "Behavior",
          "Key Flags",
          "Action",
        ]}
      >
        {rows.map((row) => (
          <TableRow key={row.repo.deal_number}>
            <TableCell className="px-3 py-2">
              <AccountCell dealNumber={row.repo.deal_number} customerName={row.repo.customer_name} />
            </TableCell>
            <TableCell className="px-3 py-2">{priorityBadge(row.priority)}</TableCell>
            <TableCell className="px-3 py-2">{formatNumber(row.repo.repo_score)}</TableCell>
            <TableCell className="px-3 py-2">{formatNumber(row.repo.days_past_due)}</TableCell>
            <TableCell className="px-3 py-2">
              {formatNumber(row.repo.days_since_last_payment ?? row.payment?.days_since_last_payment)} days
            </TableCell>
            <TableCell className="px-3 py-2">
              {formatPercent(row.payment?.payment_ratio_60d ?? row.repo.payment_ratio_60d)}
            </TableCell>
            <TableCell className="px-3 py-2">{statusBadge(row.collections?.collections_tier)}</TableCell>
            <TableCell className="px-3 py-2">{row.collections?.customer_behavior_type ?? "n/a"}</TableCell>
            <TableCell className="px-3 py-2">{flagBadges(row.keyFlags)}</TableCell>
            <TableCell className="px-3 py-2 text-right">
              <Button asChild variant="secondary" size="sm">
                <Link href={detailHref(sp, row.repo.deal_number ?? "")}>Detail</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </CompactTable>
    </SectionCard>
  );
}

function RepoRadar({ rows, sp }: { rows: RepoSignal[]; sp: SearchParams }) {
  return (
    <SectionCard title="Repo Radar" description="Top 25 accounts by repo risk score.">
      <CompactTable
        emptyTitle="No repo signals found"
        emptyDescription="No accounts matched the current filters."
        heads={["Account", "Status", "Score", "DPD", "60D Ratio", "Reversals", "Last Pay", "Flags", "Detail"]}
      >
        {rows.slice(0, 25).map((row) => (
          <TableRow key={row.deal_number}>
            <TableCell className="px-3 py-2">
              <AccountCell dealNumber={row.deal_number} customerName={row.customer_name} />
            </TableCell>
            <TableCell className="px-3 py-2">{statusBadge(row.recommended_status)}</TableCell>
            <TableCell className="px-3 py-2">{formatNumber(row.repo_score)}</TableCell>
            <TableCell className="px-3 py-2">{formatNumber(row.days_past_due)}</TableCell>
            <TableCell className="px-3 py-2">{formatPercent(row.payment_ratio_60d)}</TableCell>
            <TableCell className="px-3 py-2">{formatNumber(row.reversals_60d)}</TableCell>
            <TableCell className="px-3 py-2">{formatNumber(row.days_since_last_payment)} days</TableCell>
            <TableCell className="px-3 py-2">{flagBadges(row.risk_flags)}</TableCell>
            <TableCell className="px-3 py-2 text-right">
              <Button asChild variant="secondary" size="sm">
                <Link href={detailHref(sp, row.deal_number ?? "")}>Detail</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </CompactTable>
    </SectionCard>
  );
}

function Collections({
  rows,
  sp,
  namesByDeal,
}: {
  rows: CollectionsSignal[];
  sp: SearchParams;
  namesByDeal: Map<string, string | null>;
}) {
  return (
    <SectionCard title="Collections" description="Top 25 accounts by collections effort.">
      <CompactTable
        emptyTitle="No collections signals found"
        emptyDescription="No accounts matched the current filters."
        heads={["Account", "Tier", "Score", "Behavior", "30D Contacts", "Out/In", "Response", "Promises", "Reliability", "Detail"]}
      >
        {rows.slice(0, 25).map((row) => (
          <TableRow key={row.deal_number}>
            <TableCell className="px-3 py-2">
              <AccountCell
                dealNumber={row.deal_number}
                customerName={namesByDeal.get(row.deal_number ?? "")}
              />
            </TableCell>
            <TableCell className="px-3 py-2">{statusBadge(row.collections_tier)}</TableCell>
            <TableCell className="px-3 py-2">{formatNumber(row.collections_effort_score)}</TableCell>
            <TableCell className="px-3 py-2">{row.customer_behavior_type ?? "n/a"}</TableCell>
            <TableCell className="px-3 py-2">{formatNumber(row.contacts_30d)}</TableCell>
            <TableCell className="px-3 py-2">
              {formatNumber(row.outbound_90d)} / {formatNumber(row.inbound_90d)}
            </TableCell>
            <TableCell className="px-3 py-2">{formatPercent(row.response_rate_90d)}</TableCell>
            <TableCell className="px-3 py-2">{formatNumber(row.total_promises)}</TableCell>
            <TableCell className="px-3 py-2">{formatPercent(row.promise_reliability_life)}</TableCell>
            <TableCell className="px-3 py-2 text-right">
              <Button asChild variant="secondary" size="sm">
                <Link href={detailHref(sp, row.deal_number ?? "")}>Detail</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </CompactTable>
    </SectionCard>
  );
}

function Payments({
  rows,
  sp,
  namesByDeal,
}: {
  rows: PaymentSignal[];
  sp: SearchParams;
  namesByDeal: Map<string, string | null>;
}) {
  return (
    <SectionCard title="Payments" description="Top 25 worst recent payment behavior.">
      <CompactTable
        emptyTitle="No payment signals found"
        emptyDescription="No accounts matched the current filters."
        heads={["Account", "30D", "60D", "90D", "60D Pays", "Avg 60D", "60 Day Shortfall", "Last Pay", "Flags", "Detail"]}
      >
        {rows.map((row) => (
          <TableRow key={row.deal_number}>
            <TableCell className="px-3 py-2">
              <AccountCell
                dealNumber={row.deal_number}
                customerName={namesByDeal.get(row.deal_number ?? "")}
              />
            </TableCell>
            <TableCell className="px-3 py-2">{formatPercent(row.payment_ratio_30d)}</TableCell>
            <TableCell className="px-3 py-2">{formatPercent(row.payment_ratio_60d)}</TableCell>
            <TableCell className="px-3 py-2">{formatPercent(row.payment_ratio_90d)}</TableCell>
            <TableCell className="px-3 py-2">{formatNumber(row.payments_60d)}</TableCell>
            <TableCell className="px-3 py-2">{formatMoney(row.avg_payment_60d)}</TableCell>
            <TableCell className="px-3 py-2">{formatMoney(row.catchup_gap_estimated)}</TableCell>
            <TableCell className="px-3 py-2">{formatNumber(row.days_since_last_payment)} days</TableCell>
            <TableCell className="px-3 py-2">
              {flagBadges([
                row.fragmented_payment_flag ? "fragmented_payments" : "",
                row.survival_payment_flag ? "survival_payments" : "",
              ].filter(Boolean))}
            </TableCell>
            <TableCell className="px-3 py-2 text-right">
              <Button asChild variant="secondary" size="sm">
                <Link href={detailHref(sp, row.deal_number ?? "")}>Detail</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </CompactTable>
    </SectionCard>
  );
}

function Outcomes({
  rows,
  counts,
  sp,
  namesByDeal,
}: {
  rows: OutcomeSignal[];
  counts: Record<string, number>;
  sp: SearchParams;
  namesByDeal: Map<string, string | null>;
}) {
  return (
    <SectionCard title="Outcomes" description="Outcome counts and top 25 bad outcomes.">
      <div className="mb-3 grid gap-2 md:grid-cols-4">
        {metric("Good / Performing", counts.good ?? 0)}
        {metric("Watch / Neutral", counts.watch ?? 0, "warning")}
        {metric("Bad Outcome", counts.bad ?? 0, "danger")}
        {metric("Excluded", counts.excluded ?? 0)}
      </div>
      <CompactTable
        emptyTitle="No bad outcomes found"
        emptyDescription="No bad outcomes matched the current filters."
        heads={["Account", "Outcome", "Status", "Loss", "Net", "Bad Debt", "Recovery", "Exposure", "Detail"]}
      >
        {rows.slice(0, 25).map((row) => (
          <TableRow key={row.deal_number}>
            <TableCell className="px-3 py-2">
              <AccountCell
                dealNumber={row.deal_number}
                customerName={namesByDeal.get(row.deal_number ?? "")}
              />
            </TableCell>
            <TableCell className="px-3 py-2">{statusBadge(row.outcome_bucket)}</TableCell>
            <TableCell className="px-3 py-2">{row.account_status_normalized ?? "n/a"}</TableCell>
            <TableCell className="px-3 py-2">{formatMoney(row.loss_severity)}</TableCell>
            <TableCell className="px-3 py-2">{formatMoney(row.net_outcome_estimate)}</TableCell>
            <TableCell className="px-3 py-2">{formatMoney(row.bad_debt_amount)}</TableCell>
            <TableCell className="px-3 py-2">{formatMoney(row.recovery_amount)}</TableCell>
            <TableCell className="px-3 py-2">{formatMoney(row.exposure)}</TableCell>
            <TableCell className="px-3 py-2 text-right">
              <Button asChild variant="secondary" size="sm">
                <Link href={detailHref(sp, row.deal_number ?? "")}>Detail</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </CompactTable>
    </SectionCard>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/25 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/75">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function AccountDetail({
  deal,
  repo,
  collections,
  payment,
  outcome,
  sp,
}: {
  deal: string;
  repo: RepoSignal | null;
  collections: CollectionsSignal | null;
  payment: PaymentSignal | null;
  outcome: OutcomeSignal | null;
  sp: SearchParams;
}) {
  return (
    <SectionCard
      title="Account Detail"
      description={`Combined portfolio signals for ${repo?.customer_name || `deal ${deal}`}.`}
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link href={queryWith(sp, { deal: undefined })}>Close</Link>
        </Button>
      }
    >
      {!repo && !collections && !payment && !outcome ? (
        <EmptyState
          className="min-h-28"
          title="No account signals found"
          description="No scoped portfolio signal rows were found for that deal number."
        />
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {repo?.customer_name ? <Badge variant="default">{repo.customer_name}</Badge> : null}
            <Badge variant={repo?.customer_name ? "secondary" : "default"}>Deal {deal}</Badge>
            {repo?.recommended_status ? statusBadge(repo.recommended_status) : null}
            {collections?.collections_tier ? statusBadge(collections.collections_tier) : null}
            {outcome?.outcome_bucket ? statusBadge(outcome.outcome_bucket) : null}
          </div>
          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            <DetailMetric label="Repo Score" value={formatNumber(repo?.repo_score)} />
            <DetailMetric label="DPD" value={formatNumber(repo?.days_past_due ?? payment?.days_past_due)} />
            <DetailMetric label="60D Ratio" value={formatPercent(payment?.payment_ratio_60d ?? repo?.payment_ratio_60d)} />
            <DetailMetric label="60D Reversals" value={formatNumber(repo?.reversals_60d ?? payment?.reversals_60d)} />
            <DetailMetric label="Collections" value={formatNumber(collections?.collections_effort_score)} />
            <DetailMetric label="Outcome" value={outcome?.outcome_bucket ?? "n/a"} />
            <DetailMetric label="Behavior" value={collections?.customer_behavior_type ?? "n/a"} />
            <DetailMetric label="Scheduled Pay" value={formatMoney(payment?.scheduled_payment_amount)} />
            <DetailMetric label="Past Due" value={formatMoney(repo?.total_past_due_amount)} />
            <DetailMetric label="60 Day Shortfall" value={formatMoney(payment?.catchup_gap_estimated)} />
            <DetailMetric label="Last Pay" value={`${formatNumber(repo?.days_since_last_payment ?? payment?.days_since_last_payment)} days`} />
            <DetailMetric label="Snapshot" value={formatDate(repo?.latest_snapshot_date ?? payment?.latest_snapshot_date)} />
          </div>
          <div className="rounded-xl border border-border/75 bg-background/25 p-3">
            <div className="text-sm font-medium text-foreground">Risk flags</div>
            <div className="mt-2">{flagBadges(repo?.risk_flags, 8)}</div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function sortPayments(rows: PaymentSignal[]) {
  return [...rows]
    .sort((a, b) => {
      const aRatio = a.payment_ratio_60d ?? 999;
      const bRatio = b.payment_ratio_60d ?? 999;
      if (aRatio !== bRatio) return aRatio - bRatio;
      return (b.catchup_gap_estimated ?? 0) - (a.catchup_gap_estimated ?? 0);
    })
    .slice(0, 25);
}

export default async function PortfolioRadarPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const activeTab = currentTab(sp.tab);
  const recommendedStatus = param(sp.recommended_status);
  const collectionsTier = param(sp.collections_tier);
  const outcomeBucket = param(sp.outcome_bucket);
  const search = param(sp.q);
  const selectedDeal = param(sp.deal);
  const flagFilters = [
    boolParam(sp.repo_now) ? "repo_now.eq.true" : null,
    boolParam(sp.pre_repo) ? "pre_repo.eq.true" : null,
    boolParam(sp.watch) ? "watch.eq.true" : null,
  ].filter(Boolean);

  const supabase = await createClient();
  const authContext = await getAuthContext(supabase);
  const organizationId = authContext.currentOrganizationId;
  const canAccess =
    !!organizationId &&
    ((authContext.realRole === "dev" && !authContext.isImpersonating) ||
      authContext.effectiveOrganizationRole === "admin" ||
      authContext.effectiveOrganizationRole === "management");

  if (!organizationId) {
    return <NoticeBanner tone="error">Select an account before opening Portfolio Radar.</NoticeBanner>;
  }

  if (!canAccess) {
    return (
      <SectionCard
        title="Portfolio Radar"
        description="Portfolio risk signals are available to management, admins, and platform dev users."
      >
        <EmptyState
          title="Portfolio Radar unavailable"
          description="Your current role cannot view portfolio risk and account signal data for this organization."
        />
      </SectionCard>
    );
  }

  const repoColumns =
    "organization_id, deal_number, recommended_status, repo_score, repo_now, pre_repo, watch, days_past_due, payment_ratio_60d, payments_60d, reversals_60d, days_since_last_payment, insurance_status, repo_status, repo_stage, repo_type, repo_reason, risk_flags, latest_snapshot_date, account_status, payment_status, collector_name, vehicle_year_make_model, vehicle_stock_number, vin_last_six, balance_principal_amount, total_past_due_amount, total_payment_amount, total_payment_due_amount, total_payoff_amount, exposure, customer_name";
  const collectionsColumns =
    "organization_id, deal_number, collections_effort_score, collections_tier, customer_behavior_type, contacts_30d, contacts_60d, contacts_90d, outbound_90d, inbound_90d, response_rate_90d, promises_90d, total_promises, total_promise_amount, total_promise_kept, total_promise_broken, promise_reliability_life, days_since_last_activity";
  const paymentColumns =
    "organization_id, deal_number, latest_snapshot_date, payment_frequency, total_payment_amount, days_past_due, payments_30d, payments_60d, payments_90d, total_paid_30d, total_paid_60d, total_paid_90d, avg_payment_60d, reversals_30d, reversals_60d, reversals_90d, first_ledger_payment, last_positive_payment_date, expected_paid_30d, expected_paid_60d, expected_paid_90d, payment_ratio_30d, payment_ratio_60d, payment_ratio_90d, catchup_gap_estimated, days_since_last_payment, fragmented_payment_flag, survival_payment_flag, scheduled_payment_amount";
  const outcomeColumns =
    "organization_id, deal_number, outcome_bucket, account_status_normalized, is_bad_outcome, is_good_outcome, is_excluded, loss_severity, net_outcome_estimate, days_to_close, days_to_charge_off, days_to_repo, bad_debt_amount, recovery_amount, repo_credit, account_sale_received_amount, buy_back_cost, net_profit, exposure";

  const activeAccounts = await supabase
    .from("account_repo_signals")
    .select(repoColumns)
    .eq("organization_id", organizationId)
    .ilike("account_status", "active");

  if (activeAccounts.error) {
    return <NoticeBanner tone="error">{activeAccounts.error.message}</NoticeBanner>;
  }

  const operationalRepos = ((activeAccounts.data ?? []) as RepoSignal[]).filter(
    isOperationalActiveRepo
  );
  const operationalDealNumbers = new Set(
    operationalRepos
      .map((row) => row.deal_number)
      .filter((dealNumber): dealNumber is string => !!dealNumber)
  );
  const operationalDeals = Array.from(operationalDealNumbers);
  const inOperationalUniverse = (dealNumber: string | null | undefined) =>
    !!dealNumber && operationalDealNumbers.has(dealNumber);
  const emptyRows = Promise.resolve({ data: [], error: null });
  const emptyDetail = Promise.resolve({ data: null, error: null });

  let repoQuery = supabase
    .from("account_repo_signals")
    .select(repoColumns)
    .eq("organization_id", organizationId)
    .in("deal_number", operationalDeals);
  if (recommendedStatus) repoQuery = repoQuery.eq("recommended_status", recommendedStatus);
  if (search) repoQuery = repoQuery.ilike("deal_number", `%${search}%`);
  if (flagFilters.length) repoQuery = repoQuery.or(flagFilters.join(","));

  let collectionsQuery = supabase
    .from("account_collections_signals")
    .select(collectionsColumns)
    .eq("organization_id", organizationId)
    .in("deal_number", operationalDeals);
  if (collectionsTier) collectionsQuery = collectionsQuery.eq("collections_tier", collectionsTier);
  if (search) collectionsQuery = collectionsQuery.ilike("deal_number", `%${search}%`);

  let paymentQuery = supabase
    .from("account_payment_signals")
    .select(paymentColumns)
    .eq("organization_id", organizationId)
    .in("deal_number", operationalDeals);
  if (search) paymentQuery = paymentQuery.ilike("deal_number", `%${search}%`);

  let outcomesQuery = supabase
    .from("account_outcomes")
    .select(outcomeColumns)
    .eq("organization_id", organizationId)
    .in("deal_number", operationalDeals);
  if (outcomeBucket) outcomesQuery = outcomesQuery.eq("outcome_bucket", outcomeBucket);
  if (search) outcomesQuery = outcomesQuery.ilike("deal_number", `%${search}%`);

  const [
    summaryCollectionsResponse,
    repoResponse,
    collectionsResponse,
    paymentResponse,
    outcomesResponse,
    outcomeCountsResponse,
    importsResponse,
    detailRepoResponse,
    detailCollectionsResponse,
    detailPaymentResponse,
    detailOutcomeResponse,
  ] = await Promise.all([
    operationalDeals.length
      ? supabase
          .from("account_collections_signals")
          .select("deal_number, collections_tier")
          .eq("organization_id", organizationId)
          .in("deal_number", operationalDeals)
      : emptyRows,
    operationalDeals.length ? repoQuery.order("repo_score", { ascending: false }).limit(100) : emptyRows,
    operationalDeals.length
      ? collectionsQuery.order("collections_effort_score", { ascending: false }).limit(25)
      : emptyRows,
    operationalDeals.length ? paymentQuery.limit(100) : emptyRows,
    operationalDeals.length
      ? outcomesQuery
          .eq("is_bad_outcome", true)
          .order("loss_severity", { ascending: false })
          .order("net_outcome_estimate", { ascending: true })
          .limit(25)
      : emptyRows,
    operationalDeals.length
      ? supabase
          .from("account_outcomes")
          .select("deal_number, outcome_bucket, is_bad_outcome, is_good_outcome, is_excluded")
          .eq("organization_id", organizationId)
          .in("deal_number", operationalDeals)
      : emptyRows,
    supabase.from("dms_import_batches").select("report_type, source_filename, imported_at, row_count, status").eq("organization_id", organizationId).order("imported_at", { ascending: false }).limit(10),
    selectedDeal && inOperationalUniverse(selectedDeal)
      ? supabase.from("account_repo_signals").select(repoColumns).eq("organization_id", organizationId).eq("deal_number", selectedDeal).maybeSingle()
      : emptyDetail,
    selectedDeal && inOperationalUniverse(selectedDeal)
      ? supabase.from("account_collections_signals").select(collectionsColumns).eq("organization_id", organizationId).eq("deal_number", selectedDeal).maybeSingle()
      : emptyDetail,
    selectedDeal && inOperationalUniverse(selectedDeal)
      ? supabase.from("account_payment_signals").select(paymentColumns).eq("organization_id", organizationId).eq("deal_number", selectedDeal).maybeSingle()
      : emptyDetail,
    selectedDeal && inOperationalUniverse(selectedDeal)
      ? supabase.from("account_outcomes").select(outcomeColumns).eq("organization_id", organizationId).eq("deal_number", selectedDeal).maybeSingle()
      : emptyDetail,
  ]);

  const firstError =
    summaryCollectionsResponse.error ??
    repoResponse.error ??
    collectionsResponse.error ??
    paymentResponse.error ??
    outcomesResponse.error ??
    outcomeCountsResponse.error ??
    importsResponse.error ??
    detailRepoResponse.error ??
    detailCollectionsResponse.error ??
    detailPaymentResponse.error ??
    detailOutcomeResponse.error;

  if (firstError) return <NoticeBanner tone="error">{firstError.message}</NoticeBanner>;

  const repos = ((repoResponse.data ?? []) as RepoSignal[]).filter((row) =>
    inOperationalUniverse(row.deal_number)
  );
  const collections = ((collectionsResponse.data ?? []) as CollectionsSignal[]).filter(
    (row) => inOperationalUniverse(row.deal_number)
  );
  const payments = ((paymentResponse.data ?? []) as PaymentSignal[]).filter((row) =>
    inOperationalUniverse(row.deal_number)
  );
  const outcomes = ((outcomesResponse.data ?? []) as OutcomeSignal[]).filter((row) =>
    inOperationalUniverse(row.deal_number)
  );
  const imports = (importsResponse.data ?? []) as ImportStatus[];
  const summaryCollections = (
    (summaryCollectionsResponse.data ?? []) as Pick<
      CollectionsSignal,
      "deal_number" | "collections_tier"
    >[]
  ).filter((row) => inOperationalUniverse(row.deal_number));
  const activeAccountCount = operationalRepos.length;
  const repoNowCount = operationalRepos.filter((row) => row.repo_now).length;
  const preRepoCount = operationalRepos.filter((row) => row.pre_repo).length;
  const watchCount = operationalRepos.filter((row) => row.watch).length;
  const highEffortCount = summaryCollections.filter(
    (row) => row.collections_tier === "HIGH EFFORT / PROBLEM"
  ).length;
  const collectionsByDeal = new Map(collections.map((row) => [row.deal_number ?? "", row]));
  const paymentsByDeal = new Map(payments.map((row) => [row.deal_number ?? "", row]));
  const namesByDeal = new Map(
    operationalRepos.map((row) => [row.deal_number ?? "", row.customer_name])
  );
  const operationalOutcomeRows = ((outcomeCountsResponse.data ?? []) as OutcomeSignal[]).filter(
    (row) => inOperationalUniverse(row.deal_number)
  );
  const badOutcomeCount = operationalOutcomeRows.filter(
    (row) => row.is_bad_outcome || row.outcome_bucket === "Bad Outcome"
  ).length;
  const outcomesByDeal = new Map(
    operationalOutcomeRows.map((row) => [row.deal_number ?? "", row])
  );
  const actionRows = buildActionRows({ repos, collectionsByDeal, paymentsByDeal, outcomesByDeal });
  const paymentRows = sortPayments(payments);
  const outcomeCounts = (operationalOutcomeRows as Array<{
    outcome_bucket: string | null;
    is_bad_outcome: boolean | null;
    is_good_outcome: boolean | null;
    is_excluded: boolean | null;
  }>).reduce(
    (counts, row) => {
      if (row.is_excluded || row.outcome_bucket === "Excluded") counts.excluded += 1;
      else if (row.is_bad_outcome || row.outcome_bucket === "Bad Outcome") counts.bad += 1;
      else if (row.is_good_outcome || row.outcome_bucket === "Good / Performing") counts.good += 1;
      else counts.watch += 1;
      return counts;
    },
    { good: 0, watch: 0, bad: 0, excluded: 0 }
  );

  return (
    <div className="grid gap-4">
      <PageHeader
        eyebrow="Portfolio"
        title="Portfolio Radar"
        description="Repo risk, collections effort, payment behavior, and outcomes for active accounts."
        actions={
          <Badge variant="secondary" className="gap-2">
            <Radar className="size-3.5" />
            Organization scoped
          </Badge>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        {metric("Active Accounts", activeAccountCount)}
        {metric("Repo Now", repoNowCount, "danger")}
        {metric("Pre-Repo", preRepoCount, "warning")}
        {metric("Watch", watchCount, "warning")}
        {metric("High Effort", highEffortCount, "danger")}
        {metric("Bad Outcome", badOutcomeCount, "danger")}
      </div>

      <RecentImportsCompact imports={imports} />
      {selectedDeal ? (
        <AccountDetail
          deal={selectedDeal}
          repo={(detailRepoResponse.data ?? null) as RepoSignal | null}
          collections={(detailCollectionsResponse.data ?? null) as CollectionsSignal | null}
          payment={(detailPaymentResponse.data ?? null) as PaymentSignal | null}
          outcome={(detailOutcomeResponse.data ?? null) as OutcomeSignal | null}
          sp={sp}
        />
      ) : null}

      <Filters sp={sp} />
      <TabNav active={activeTab} sp={sp} />

      {activeTab === "action" ? (
        <ActionList rows={actionRows} sp={sp} />
      ) : activeTab === "repo" ? (
        <RepoRadar rows={repos.slice(0, 25)} sp={sp} />
      ) : activeTab === "collections" ? (
        <Collections rows={collections.slice(0, 25)} sp={sp} namesByDeal={namesByDeal} />
      ) : activeTab === "payments" ? (
        <Payments rows={paymentRows} sp={sp} namesByDeal={namesByDeal} />
      ) : activeTab === "outcomes" ? (
        <Outcomes rows={outcomes} counts={outcomeCounts} sp={sp} namesByDeal={namesByDeal} />
      ) : (
        <ImportsTab imports={imports} />
      )}
    </div>
  );
}
