"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Step = { key: string; label: string; href: (dealId: string) => string };

const steps: Step[] = [
  { key: "customer", label: "Customer", href: (id) => `/deals/${id}/customer` },
  { key: "income", label: "Income", href: (id) => `/deals/${id}/income` },
  { key: "vehicle", label: "Vehicle", href: (id) => `/deals/${id}/vehicle` },
  { key: "deal", label: "Deal", href: (id) => `/deals/${id}/deal` },
  { key: "submit", label: "Submit", href: (id) => `/deals/${id}/submit` },
  { key: "fund", label: "Fund", href: (id) => `/deals/${id}/fund` },
];

export function DealStepNav({ dealId }: { dealId: string }) {
  const pathname = usePathname();

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid #eee", borderRadius: 12 }}>
      <div style={{ fontWeight: 800 }}>Deal</div>
      <div style={{ opacity: 0.6, marginRight: 10 }}>{dealId ? dealId.slice(0, 8) : "—"}…</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {steps.map((s, idx) => {
          const url = s.href(dealId);
          const active = pathname?.startsWith(url);
          return (
            <Link
              key={s.key}
              href={url}
              style={{
                textDecoration: "none",
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #ddd",
                fontWeight: 800,
                opacity: active ? 1 : 0.75,
                background: active ? "#f3f4f6" : "white",
              }}
            >
              {idx + 1}. {s.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}