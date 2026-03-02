"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { DealStepNav } from "@/components/DealStepNav";

type DealQuery = {
  vehicleId: string | null;
  option: string | null;
  pmt: string | null;
  term: string | null;
  cashDown: string | null;
  vsc: string | null;
  gap: string | null;
};

type Selection = {
  deal_id: string;
  vehicle_id: string;
  option_label: "NONE" | "VSC" | "GAP" | "VSC+GAP";
  include_vsc: boolean;
  include_gap: boolean;
  term_months: number;
  monthly_payment: number;
  cash_down: number | null;
  created_at?: string;
  updated_at?: string;
};

function asString(value: string | string[] | undefined): string {
  if (!value) return "";
  return Array.isArray(value) ? value[0] : value;
}

function money(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function parseNumOrNull(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseBool(s: string | null) {
  if (!s) return false;
  return s === "true" || s === "1" || s.toLowerCase() === "yes";
}

function isValidLabel(v: string | null): v is Selection["option_label"] {
  if (!v) return false;
  const s = v.toUpperCase();
  return s === "NONE" || s === "VSC" || s === "GAP" || s === "VSC+GAP";
}

export default function DealDealPage() {
  const params = useParams();
  const sp = useSearchParams();
  const router = useRouter();

  const dealId = asString(params?.dealId);

  const query: DealQuery = useMemo(
    () => ({
      vehicleId: sp.get("vehicleId"),
      option: sp.get("option"),
      pmt: sp.get("pmt"),
      term: sp.get("term"),
      cashDown: sp.get("cashDown"),
      vsc: sp.get("vsc"),
      gap: sp.get("gap"),
    }),
    [sp]
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  const hasQuerySelection = useMemo(() => {
    return (
      !!query.vehicleId &&
      isValidLabel(query.option) &&
      parseNumOrNull(query.pmt) != null &&
      parseNumOrNull(query.term) != null
    );
  }, [query.vehicleId, query.option, query.pmt, query.term]);

  async function loadSelection() {
    if (!dealId) return;
    setLoading(true);
    setErr(null);

    try {
      const r = await fetch(`/api/deals/${dealId}/vehicle-selection`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.details || j?.error || "Failed to load selection");
      setSelection(j.selection ?? null);
    } catch (e: any) {
      setErr(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function persistFromQueryThenCleanUrl() {
    if (!dealId) return;
    if (!hasQuerySelection) return;

    setSaving(true);
    setErr(null);

    try {
      const payload = {
        vehicle_id: query.vehicleId,
        option_label: (query.option ?? "").toUpperCase(),
        include_vsc: parseBool(query.vsc),
        include_gap: parseBool(query.gap),
        term_months: Number(query.term),
        monthly_payment: Number(query.pmt),
        cash_down: parseNumOrNull(query.cashDown),
      };

      const r = await fetch(`/api/deals/${dealId}/vehicle-selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await r.json();
      if (!r.ok) throw new Error(j?.details || j?.error || "Failed to save selection");

      setSelection(j.selection ?? null);

      // Clean URL (remove querystring) but stay on Step 4
      router.replace(`/deals/${dealId}/deal`);
    } catch (e: any) {
      setErr(e?.message || "Failed to save selection");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!dealId) return;

    // If querystring has selection, persist it and then clean the URL.
    // Otherwise, just load whatever is saved.
    if (hasQuerySelection) {
      persistFromQueryThenCleanUrl();
      return;
    }

    loadSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, hasQuerySelection]);

  const canNext = !!selection && !loading && !saving;

  function onPrev() {
    router.push(`/deals/${dealId}/vehicle`);
  }

  function onNext() {
    setErr(null);
    if (!selection) {
      setErr("No vehicle selection saved. Go back to Step 3 and pick an option.");
      return;
    }
    router.push(`/deals/${dealId}/submit`);
  }

  if (!dealId) {
    return (
      <div style={{ padding: 16, color: "crimson" }}>
        Missing dealId in route params. (Check folder name:{" "}
        <code>deals/[dealId]/deal</code>)
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <DealStepNav dealId={dealId} />

      {/* Header + Prev/Next */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Step 4: Deal</h2>

        {loading ? <span style={{ opacity: 0.7 }}>Loading…</span> : null}
        {saving ? <span style={{ opacity: 0.7 }}>Saving…</span> : null}
        {err ? <span style={{ color: "crimson", fontWeight: 900 }}>{err}</span> : null}

        <div style={{ flex: 1 }} />

        <button type="button" onClick={onPrev} style={btnSecondary}>
          ← Previous
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          style={{
            ...btnPrimary,
            background: canNext ? "#111" : "#999",
            cursor: canNext ? "pointer" : "not-allowed",
          }}
          title={!selection ? "Select a vehicle option in Step 3" : ""}
        >
          Next →
        </button>
      </div>

      {/* Selection card */}
      <div style={{ ...card, background: "#fafafa" }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Vehicle Selection</div>

        {!selection ? (
          <div style={{ opacity: 0.85 }}>
            No selection saved yet. Go to <b>Step 3</b> and click a payment option.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
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

              <div style={k}>Monthly Payment</div>
              <div style={v}>
                <b>{money(selection.monthly_payment)}</b>
              </div>

              <div style={k}>Term</div>
              <div style={v}>
                <b>{selection.term_months}</b> months
              </div>

              <div style={k}>Cash Down</div>
              <div style={v}>
                {selection.cash_down != null ? money(selection.cash_down) : "—"}
              </div>
            </div>

            <div style={{ opacity: 0.75, fontSize: 13 }}>
              Next: we’ll build the deal math (taxes, fee pack, VSC/GAP pricing rules) and write
              the full approval package.
            </div>
          </div>
        )}
      </div>

      {/* Debug (only helpful while you’re wiring this up) */}
      <div style={card}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Debug</div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.85 }}>
{JSON.stringify(
  {
    dealId,
    query,
    hasQuerySelection,
    selection,
  },
  null,
  2
)}
        </pre>
      </div>
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