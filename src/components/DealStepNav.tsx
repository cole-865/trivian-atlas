"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DealStep } from "@/lib/deals/canAccessStep";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Step = { key: DealStep; label: string; href: (dealId: string) => string };

const steps: Step[] = [
  { key: "customer", label: "Customer", href: (id) => `/deals/${id}/customer` },
  { key: "income", label: "Income", href: (id) => `/deals/${id}/income` },
  { key: "vehicle", label: "Vehicle", href: (id) => `/deals/${id}/vehicle` },
  { key: "deal", label: "Deal", href: (id) => `/deals/${id}/deal` },
  { key: "submit", label: "Submit", href: (id) => `/deals/${id}/submit` },
  { key: "fund", label: "Fund", href: (id) => `/deals/${id}/fund` },
];

export function DealStepNav({
  dealId,
  customerName,
  tier,
  access,
}: {
  dealId: string;
  customerName?: string | null;
  tier?: string | null;
  access?: Partial<Record<DealStep, boolean>>;
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-4 py-3 shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
      <div className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
        Deal
      </div>
      <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/75">
        {customerName?.trim() || (dealId ? `${dealId.slice(0, 8)}…` : "—")}
      </div>

      {tier ? <Badge variant="default">Tier {tier}</Badge> : null}

      <div className="ml-0 flex flex-wrap gap-2 sm:ml-2">
        {steps.map((s, idx) => {
          const url = s.href(dealId);
          const active = pathname?.startsWith(url);
          const allowed = access?.[s.key] ?? true;
          const stepClassName = cn(
            "inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
            active
              ? "border-primary/30 bg-primary/12 text-primary"
              : allowed
                ? "border-border/75 bg-background/35 text-muted-foreground hover:bg-accent/80 hover:text-accent-foreground"
                : "cursor-not-allowed border-border/60 bg-background/20 text-muted-foreground/50"
          );

          if (!allowed && !active) {
            return (
              <span
                key={s.key}
                className={stepClassName}
                aria-disabled="true"
                title="Complete prior steps first"
              >
                {idx + 1}. {s.label}
              </span>
            );
          }

          return (
            <Link key={s.key} href={url} className={stepClassName}>
              {idx + 1}. {s.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
