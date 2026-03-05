"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DealStepNav } from "@/components/DealStepNav";

function asString(value: string | string[] | undefined): string {
  if (!value) return "";
  return Array.isArray(value) ? value[0] : value;
}

type Selection = {
  deal_id: string;
  vehicle_id: string;
  option_label: string;
  include_vsc: boolean;
  include_gap: boolean;
  term_months: number;
  monthly_payment: number;
  cash_down: number | null;
};

function money(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function DealSubmitPage() {
  const params = useParams();
  const router = useRouter();
  const dealId = asString(params?.dealId);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    if (!dealId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const r = await fetch(`/api/deals/${dealId}/vehicle-selection`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.details || j?.error || "Failed to load selection");

        if (!cancelled) setSelection(j.selection ?? null);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  const canSubmit = useMemo(() => {
    // For now: require vehicle selection. Later: require docs + income + people completion, etc.
    return !!selection;
  }, [selection]);

  function onPrev() {
    router.push(`/deals/${dealId}/deal`);
  }

  function onNext() {
    setErr(null);
    if (!canSubmit) {
      setErr("Missing vehicle selection. Go back and complete Step 3/4.");
      return;
    }
    router.push(`/deals/${dealId}/fund`);
  }

  if (!dealId) {
    return (
      <div style={{ padding: 16, color: "crimson" }}>
        Missing dealId in route params. (Check folder name:{" "}
        <code>deals/[dealId]/submit</code>)
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <DealStepNav dealId={dealId} />

      {/* Header + Prev/Next */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Step 5: Submit</h2>

        <div style={{ flex: 1 }} />

        <button type="button" onClick={onPrev} style={btnSecondary}>
          ← Previous
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={!canSubmit || loading}
          style={{
            ...btnPrimary,
            background: !canSubmit || loading ? "#999" : "#111",
            cursor: !canSubmit || loading ? "not-allowed" : "pointer",
          }}
        >
          Next →
        </button>
      </div>

      {loading ? <div style={{ opacity: 0.8 }}>Loading…</div> : null}
      {err ? <div style={{ color: "crimson", fontWeight: 900 }}>{err}</div> : null}

      {/* Preflight */}
      <div style={{ ...card, background: "#fafafa" }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Preflight Checklist</div>

        <div style={{ display: "grid", gap: 8 }}>
          <Row ok={!!selection} label="Vehicle selection saved" />
          <Row ok={true} label="Income applied (we’ll validate later)" />
          <Row ok={true} label="Docs uploaded (we’ll validate later)" />
        </div>

        {selection ? (
          <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Selection</div>
            <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 10 }}>
              <div style={k}>Vehicle ID</div>
              <div style={v}>{selection.vehicle_id}</div>

              <div style={k}>Package</div>
              <div style={v}>
                <b>{selection.option_label}</b>{" "}
                <span style={{ opacity: 0.75, fontSize: 13 }}>
                  ({selection.include_vsc ? "VSC" : "No VSC"} •{" "}
                  {selection.include_gap ? "GAP" : "No GAP"})
                </span>
              </div>

              <div style={k}>Payment</div>
              <div style={v}>
                <b>{money(selection.monthly_payment)}</b>
              </div>

              <div style={k}>Term</div>
              <div style={v}>
                <b>{selection.term_months}</b> months
              </div>

              <div style={k}>Cash Down</div>
              <div style={v}>{selection.cash_down != null ? money(selection.cash_down) : "—"}</div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10, opacity: 0.85 }}>
            No selection found. That means Step 4 still isn’t persisting the choice yet.
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <span style={{ fontWeight: 900, color: ok ? "green" : "crimson" }}>
        {ok ? "✓" : "✕"}
      </span>
      <span style={{ fontWeight: 800 }}>{label}</span>
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  borderRadius: 14,
  padding: 14,
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  fontWeight: 900,
};

const btnSecondary: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 900,
};

const k: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.7,
  fontWeight: 900,
};

const v: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
};