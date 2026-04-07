"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import type { DealStep } from "@/lib/deals/canAccessStep";

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
  tier,
  access,
}: {
  dealId: string;
  tier?: string | null;
  access?: Partial<Record<DealStep, boolean>>;
}) {
  const pathname = usePathname();

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        padding: "10px 12px",
        border: "1px solid #eee",
        borderRadius: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ fontWeight: 800 }}>Deal</div>
      <div style={{ opacity: 0.6 }}>{dealId ? dealId.slice(0, 8) : "—"}…</div>

      {tier ? (
        <div
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            border: "1px solid #ddd",
            fontWeight: 800,
            background: "#fafafa",
          }}
        >
          Tier {tier}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: 6 }}>
        {steps.map((s, idx) => {
          const url = s.href(dealId);
          const active = pathname?.startsWith(url);
          const allowed = access?.[s.key] ?? true;
          const style = {
            textDecoration: "none",
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid #ddd",
            fontWeight: 800,
            opacity: active ? 1 : allowed ? 0.75 : 0.45,
            background: active ? "#f3f4f6" : allowed ? "white" : "#f8f8f8",
            color: allowed ? "#111" : "#777",
            cursor: allowed ? "pointer" : "not-allowed",
          } satisfies CSSProperties;

          if (!allowed && !active) {
            return (
              <span key={s.key} style={style} aria-disabled="true" title="Complete prior steps first">
                {idx + 1}. {s.label}
              </span>
            );
          }

          return (
            <Link key={s.key} href={url} style={style}>
              {idx + 1}. {s.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
