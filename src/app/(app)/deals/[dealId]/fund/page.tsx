"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
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

type DealDocument = {
  id: string;
  deal_id: string;
  doc_type: string;
  storage_bucket: string;
  storage_path: string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

type FundResponse = {
  ok: boolean;
  deal: {
    id: string;
    workflow_status: string | null;
    submit_status: string | null;
    funding_notes: string | null;
    internal_notes: string | null;
    submitted_at: string | null;
    funded_at?: string | null;
  } | null;
  selection: Selection | null;
  documents: {
    credit_bureau: DealDocument | null;
    proof_of_income: DealDocument[];
    proof_of_residence: DealDocument[];
    driver_license: DealDocument[];
    insurance: DealDocument[];
    references: DealDocument[];
    other: DealDocument[];
  } | null;
  checklist: {
    submitted: boolean;
    credit_bureau: boolean;
    required_stips: boolean;
  } | null;
};

function money(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function yesNo(v: boolean) {
  return v ? "Yes" : "No";
}

function formatDate(ts: string | null | undefined) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function DealFundPage() {
  const params = useParams();
  const dealId = asString(params?.dealId);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<FundResponse | null>(null);

  useEffect(() => {
    if (!dealId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const r = await fetch(`/api/deals/${dealId}/fund`, {
          cache: "no-store",
        });

        const j: FundResponse = await r.json().catch(() => ({
          ok: false,
          deal: null,
          selection: null,
          documents: null,
          checklist: null,
        }));

        if (!r.ok) {
          throw new Error((j as any)?.details || (j as any)?.error || "Failed to load fund page");
        }

        if (!cancelled) {
          setData(j);
        }
      } catch (e: any) {
        if (!cancelled) {
          setErr(e?.message || "Failed to load fund page");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [dealId]);

  const requiredDocCounts = useMemo(() => {
    return {
      proof_of_income: data?.documents?.proof_of_income?.length ?? 0,
      proof_of_residence: data?.documents?.proof_of_residence?.length ?? 0,
      driver_license: data?.documents?.driver_license?.length ?? 0,
    };
  }, [data]);

  if (!dealId) {
    return (
      <div style={{ padding: 16, color: "crimson" }}>
        Missing dealId in route params. (Check folder name: <code>deals/[dealId]/fund</code>)
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "grid", gap: 14 }}>

      <div>
        <h2 style={{ margin: "14px 0 4px" }}>Step 6: Fund</h2>
        <div style={{ fontSize: 13, color: "#666", fontWeight: 600 }}>
          Funding review, packet status, and final disposition.
        </div>
      </div>

      {loading ? <div style={infoBox}>Loading funding packet…</div> : null}
      {err ? <div style={errorBox}>{err}</div> : null}

      {!loading && !err && data ? (
        <>
          <div style={gridTwo}>
            <section style={card}>
              <div style={sectionTitle}>Funding Readiness</div>

              <div style={{ display: "grid", gap: 10 }}>
                <CheckRow
                  ok={!!data.checklist?.submitted}
                  label="Deal submitted"
                  detail={
                    data.checklist?.submitted
                      ? "Step 5 handoff completed."
                      : "Deal has not been formally submitted."
                  }
                />
                <CheckRow
                  ok={!!data.checklist?.credit_bureau}
                  label="Credit bureau present"
                  detail={
                    data.checklist?.credit_bureau
                      ? "Credit bureau file is attached."
                      : "Credit bureau file is missing."
                  }
                />
                <CheckRow
                  ok={!!data.checklist?.required_stips}
                  label="Required stips present"
                  detail={
                    data.checklist?.required_stips
                      ? "Required stip docs are on file."
                      : "One or more required stip docs are missing."
                  }
                />
              </div>
            </section>

            <section style={card}>
              <div style={sectionTitle}>Submit Metadata</div>

              <div style={kvGrid}>
                <div style={k}>Workflow Status</div>
                <div style={v}>{data.deal?.workflow_status || "—"}</div>

                <div style={k}>Submit Status</div>
                <div style={v}>{data.deal?.submit_status || "—"}</div>

                <div style={k}>Submitted At</div>
                <div style={v}>{formatDate(data.deal?.submitted_at)}</div>

                <div style={k}>Funded At</div>
                <div style={v}>{formatDate(data.deal?.funded_at)}</div>
              </div>
            </section>
          </div>

          <div style={gridTwo}>
            <section style={card}>
              <div style={sectionTitle}>Structure Summary</div>

              {data.selection ? (
                <div style={kvGrid}>
                  <div style={k}>Vehicle ID</div>
                  <div style={v}>{data.selection.vehicle_id}</div>

                  <div style={k}>Package</div>
                  <div style={v}>{data.selection.option_label}</div>

                  <div style={k}>Monthly Payment</div>
                  <div style={vStrong}>{money(data.selection.monthly_payment)}</div>

                  <div style={k}>Term</div>
                  <div style={vStrong}>{data.selection.term_months} months</div>

                  <div style={k}>Cash Down</div>
                  <div style={vStrong}>
                    {data.selection.cash_down != null ? money(data.selection.cash_down) : "—"}
                  </div>

                  <div style={k}>VSC</div>
                  <div style={v}>{yesNo(data.selection.include_vsc)}</div>

                  <div style={k}>GAP</div>
                  <div style={v}>{yesNo(data.selection.include_gap)}</div>
                </div>
              ) : (
                <div style={{ color: "#666", fontWeight: 700 }}>No saved structure found.</div>
              )}
            </section>

            <section style={card}>
              <div style={sectionTitle}>Required Stip Summary</div>

              <div style={kvGrid}>
                <div style={k}>Proof of Income</div>
                <div style={v}>{requiredDocCounts.proof_of_income} file(s)</div>

                <div style={k}>Proof of Residence</div>
                <div style={v}>{requiredDocCounts.proof_of_residence} file(s)</div>

                <div style={k}>Driver License</div>
                <div style={v}>{requiredDocCounts.driver_license} file(s)</div>

                <div style={k}>Credit Bureau</div>
                <div style={v}>{data.documents?.credit_bureau ? "Present" : "Missing"}</div>
              </div>
            </section>
          </div>

          <div style={gridTwo}>
            <section style={card}>
              <div style={sectionTitle}>Funding Notes</div>
              <div style={noteBox}>{data.deal?.funding_notes?.trim() || "No funding notes."}</div>
            </section>

            <section style={card}>
              <div style={sectionTitle}>Internal Notes</div>
              <div style={noteBox}>{data.deal?.internal_notes?.trim() || "No internal notes."}</div>
            </section>
          </div>

          <section style={card}>
            <div style={sectionTitle}>Next Step</div>
            <div style={{ color: "#555", lineHeight: 1.5, fontWeight: 700 }}>
              After this read screen is working, wire in the real funding actions:
              pending stips, ready to fund, sent back, and funded.
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function CheckRow({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "22px 1fr",
        gap: 10,
        alignItems: "start",
        padding: "10px 12px",
        border: "1px solid #ececec",
        borderRadius: 12,
        background: ok ? "#f8fff8" : "#fff8f8",
      }}
    >
      <div
        style={{
          fontWeight: 900,
          color: ok ? "green" : "crimson",
          fontSize: 16,
          lineHeight: "18px",
        }}
      >
        {ok ? "✓" : "✕"}
      </div>

      <div>
        <div style={{ fontWeight: 900, fontSize: 14 }}>{label}</div>
        <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{detail}</div>
      </div>
    </div>
  );
}

const gridTwo: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
  gap: 14,
};

const card: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  borderRadius: 14,
  padding: 16,
  background: "#fff",
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 16,
  marginBottom: 12,
};

const kvGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "160px 1fr",
  gap: 10,
};

const k: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
  fontWeight: 900,
  alignSelf: "center",
};

const v: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
};

const vStrong: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 900,
};

const noteBox: React.CSSProperties = {
  minHeight: 110,
  whiteSpace: "pre-wrap",
  border: "1px solid #ececec",
  borderRadius: 12,
  padding: 12,
  background: "#fcfcfc",
  fontSize: 14,
  lineHeight: 1.5,
  fontWeight: 700,
  color: "#333",
};

const infoBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid #e5e5e5",
  background: "#fafafa",
  fontWeight: 700,
};

const errorBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid #f1b5b5",
  background: "#fff3f3",
  color: "crimson",
  fontWeight: 900,
};