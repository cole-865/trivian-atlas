"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { DealStep } from "@/lib/deals/canAccessStep";

function asString(value: string | string[] | undefined): string {
  if (!value) return "";
  return Array.isArray(value) ? value[0] : value;
}

type SavedStructureSummary = {
  deal_id: string;
  vehicle_id: string;
  option_label: string;
  include_vsc: boolean;
  include_gap: boolean;
  term_months: number;
  monthly_payment: number;
  cash_down: number | null;
  ltv: number | null;
  pti: number | null;
};

type DealDocument = {
  id: string;
  deal_id: string;
  doc_type: string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

type RequiredDocType = "proof_of_income" | "proof_of_residence" | "driver_license";

type FundingVerification = {
  id: string;
  doc_type: RequiredDocType;
  status: "verified" | "rejected";
  rejection_reason: string | null;
  verified_monthly_income: number | null;
  structure_fingerprint: string;
  verified_by: string | null;
  verified_at: string;
};

type FundingStip = {
  doc_type: RequiredDocType;
  label: string;
  documents: DealDocument[];
  targets: string[];
  verification: FundingVerification | null;
  is_current: boolean;
};

type FundResponse = {
  ok: boolean;
  error?: string;
  details?: string;
  reason?: string;
  redirectTo?: DealStep;
  deal: {
    id: string;
    customer_name: string | null;
    workflow_status: string | null;
    submit_status: string | null;
    funding_notes: string | null;
    funding_status: string | null;
    funding_decision_notes: string | null;
    internal_notes: string | null;
    submitted_at: string | null;
    funded_at?: string | null;
  } | null;
  selection: SavedStructureSummary | null;
  documents: {
    credit_bureau: DealDocument | null;
  } | null;
  stips: FundingStip[];
  current_structure_fingerprint: string | null;
  checklist: {
    submitted: boolean;
    credit_bureau: boolean;
    required_stips: boolean;
    required_stips_verified: boolean;
    structure_unchanged: boolean;
    funding_rejected: boolean;
  } | null;
};

type FundErrorResponse = {
  ok: false;
  deal: null;
  selection: null;
  documents: null;
  stips?: FundingStip[];
  checklist: null;
  details?: string;
  error?: string;
  reason?: string;
  redirectTo?: DealStep;
};

function money(n: number | null | undefined) {
  if (n == null) return "-";
  const v = Number(n);
  return Number.isFinite(v)
    ? v.toLocaleString(undefined, { style: "currency", currency: "USD" })
    : "-";
}

function yesNo(v: boolean) {
  return v ? "Yes" : "No";
}

function formatDate(ts: string | null | undefined) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function formatBytes(bytes: number | null | undefined) {
  const value = Number(bytes ?? 0);
  if (!value) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function percent(value: number | null | undefined) {
  if (!value) return "-";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

export default function DealFundPage() {
  const params = useParams();
  const router = useRouter();
  const dealId = asString(params?.dealId);

  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fundSummary, setFundSummary] = useState<FundResponse | null>(null);

  const load = useCallback(async () => {
    if (!dealId) return;

    setLoading(true);
    setErr(null);

    try {
      const r = await fetch(`/api/deals/${dealId}/fund`, {
        cache: "no-store",
      });

      const response: FundResponse | FundErrorResponse = await r.json().catch(() => ({
        ok: false,
        deal: null,
        selection: null,
        documents: null,
        checklist: null,
      }));

      if (!r.ok) {
        if (response.error === "STEP_BLOCKED" && response.redirectTo) {
          router.replace(`/deals/${dealId}/${response.redirectTo}`);
          return;
        }

        throw new Error(response.details || response.reason || response.error || "Failed to load fund page");
      }

      setFundSummary(response as FundResponse);
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Failed to load fund page");
    } finally {
      setLoading(false);
    }
  }, [dealId, router]);

  useEffect(() => {
    let cancelled = false;
    if (!dealId) return;

    async function loadScoped() {
      await load();
      if (cancelled) return;
    }

    void loadScoped();

    return () => {
      cancelled = true;
    };
  }, [dealId, load]);

  const savedStructure = fundSummary?.selection ?? null;
  const canFund = !!fundSummary?.checklist?.required_stips_verified && !fundSummary.checklist.funding_rejected;
  const incomeRejected = fundSummary?.stips.find(
    (stip) => stip.doc_type === "proof_of_income" && stip.verification?.status === "rejected"
  ) ?? null;

  const statusText = useMemo(() => {
    if (!fundSummary?.deal) return "Not loaded";
    if (fundSummary.deal.funding_status === "funded") return "Funded";
    if (fundSummary.deal.funding_status === "funded_with_changes") return "Funded with changes";
    if (fundSummary.deal.funding_status === "restructure_requested") return "Sent back to underwriting";
    if (fundSummary.deal.funding_status === "rejected" || fundSummary.checklist?.funding_rejected) {
      return "Rejected";
    }
    if (canFund) return "Ready to fund";
    return "Funding review";
  }, [canFund, fundSummary]);

  async function runFundingAction(body: Record<string, unknown>, successMessage: string, key: string) {
    setErr(null);
    setSuccess(null);
    setWorkingKey(key);

    try {
      const r = await fetch(`/api/deals/${dealId}/fund`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        throw new Error(j?.details || j?.error || "Funding action failed.");
      }

      setSuccess(successMessage);
      await load();
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Funding action failed.");
    } finally {
      setWorkingKey(null);
    }
  }

  function onViewDocument(doc: DealDocument) {
    window.open(`/api/deals/${dealId}/documents/${doc.id}`, "_blank", "noopener,noreferrer");
  }

  function onRejectStip(stip: FundingStip) {
    const reason = window.prompt(`What did not verify for ${stip.label}?`);
    if (!reason?.trim()) return;

    const verifiedMonthlyIncome =
      stip.doc_type === "proof_of_income"
        ? window.prompt("What is the actual verified monthly income?")
        : null;

    if (stip.doc_type === "proof_of_income" && !verifiedMonthlyIncome?.trim()) {
      setErr("Actual verified monthly income is required when proof of income does not verify.");
      return;
    }

    void runFundingAction(
      {
        action: "reject_stip",
        doc_type: stip.doc_type,
        rejection_reason: reason.trim(),
        verified_monthly_income: verifiedMonthlyIncome?.trim() ?? null,
      },
      `${stip.label} marked as not verified.`,
      `reject:${stip.doc_type}`
    );
  }

  function onSendBackToUnderwriter() {
    const reason = window.prompt("What should underwriting know for the restructure?");

    void runFundingAction(
      {
        action: "send_back_to_underwriter",
        reason: reason?.trim() || null,
      },
      "Sent back to underwriting to restructure.",
      "send-back"
    );
  }

  function onRejectFunding() {
    const reason = window.prompt("Why is funding rejected?");
    if (!reason?.trim()) return;

    void runFundingAction(
      {
        action: "reject_funding",
        reason: reason.trim(),
      },
      "Funding rejection sent.",
      "reject-funding"
    );
  }

  if (!dealId) {
    return (
      <div style={{ padding: 16, color: "crimson" }}>
        Missing dealId in route params. (Check folder name: <code>deals/[dealId]/fund</code>)
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "grid", gap: 14 }}>
      <div style={headerRow}>
        <div>
          <h2 style={{ margin: "0 0 4px" }}>Step 6: Fund</h2>
          <div style={{ fontSize: 13, color: "#666", fontWeight: 600 }}>
            Verify stips, confirm the structure, and make the funding call.
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <button type="button" style={btnSecondary} onClick={onRejectFunding} disabled={!!workingKey || loading}>
          Reject Funding
        </button>
        <button
          type="button"
          style={{
            ...btnPrimary,
            background: !canFund || !!workingKey || loading ? "#999" : "#111",
            borderColor: !canFund || !!workingKey || loading ? "#999" : "#111",
            cursor: !canFund || !!workingKey || loading ? "not-allowed" : "pointer",
          }}
          disabled={!canFund || !!workingKey || loading}
          onClick={() => runFundingAction({ action: "fund" }, "Deal funded. Notifications sent.", "fund")}
        >
          {workingKey === "fund" ? "Funding..." : "Fund"}
        </button>
        {incomeRejected ? (
          <>
            <button
              type="button"
              style={btnSecondary}
              disabled={!!workingKey || loading}
              onClick={() =>
                runFundingAction(
                  { action: "fund_with_income_change" },
                  "Deal funded with verified income changes. Notifications sent.",
                  "fund-with-income-change"
                )
              }
            >
              {workingKey === "fund-with-income-change" ? "Funding..." : "Approve With Changes"}
            </button>
            <button
              type="button"
              style={btnSecondary}
              disabled={!!workingKey || loading}
              onClick={onSendBackToUnderwriter}
            >
              {workingKey === "send-back" ? "Sending..." : "Send Back to Underwriter"}
            </button>
          </>
        ) : null}
      </div>

      {loading ? <div style={infoBox}>Loading funding packet...</div> : null}
      {err ? <div style={errorBox}>{err}</div> : null}
      {success ? <div style={successBox}>{success}</div> : null}

      {!loading && !err && fundSummary ? (
        <>
          <div style={gridTwo}>
            <section style={card}>
              <div style={sectionTitle}>Funding Status</div>
              <div style={{ fontSize: 24, fontWeight: 900 }}>{statusText}</div>
              <div style={helperText}>
                Fund only when every required stip is verified and the structure has not changed.
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                <CheckRow ok={!!fundSummary.checklist?.submitted} label="Deal submitted" />
                <CheckRow ok={!!fundSummary.checklist?.credit_bureau} label="Credit bureau present" />
                <CheckRow ok={!!fundSummary.checklist?.required_stips} label="Required stips uploaded" />
                <CheckRow ok={!!fundSummary.checklist?.required_stips_verified} label="Required stips verified" />
                <CheckRow ok={!!fundSummary.checklist?.structure_unchanged} label="Structure unchanged since verification" />
              </div>
            </section>

            <section style={card}>
              <div style={sectionTitle}>Structure Summary</div>

              {savedStructure ? (
                <div style={kvGrid}>
                  <div style={k}>Vehicle ID</div>
                  <div style={v}>{savedStructure.vehicle_id}</div>

                  <div style={k}>Package</div>
                  <div style={v}>{savedStructure.option_label}</div>

                  <div style={k}>Monthly Payment</div>
                  <div style={vStrong}>{money(savedStructure.monthly_payment)}</div>

                  <div style={k}>LTV</div>
                  <div style={vStrong}>{percent(savedStructure.ltv)}</div>

                  <div style={k}>PTI</div>
                  <div style={vStrong}>{percent(savedStructure.pti)}</div>

                  <div style={k}>Term</div>
                  <div style={vStrong}>{savedStructure.term_months} months</div>

                  <div style={k}>Cash Down</div>
                  <div style={vStrong}>{money(savedStructure.cash_down)}</div>

                  <div style={k}>VSC</div>
                  <div style={v}>{yesNo(savedStructure.include_vsc)}</div>

                  <div style={k}>GAP</div>
                  <div style={v}>{yesNo(savedStructure.include_gap)}</div>
                </div>
              ) : (
                <div style={{ color: "#666", fontWeight: 700 }}>No saved structure found.</div>
              )}
            </section>
          </div>

          <section style={card}>
            <div style={sectionTitle}>Stip Verification</div>
            <div style={helperText}>
              Review the file, compare it to the targets, then verify it or mark what did not verify.
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {fundSummary.stips.map((stip) => (
                <div key={stip.doc_type} style={stipRow}>
                  <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 900 }}>{stip.label}</div>
                      <span style={statusPill(stip)}>{stipStatusText(stip)}</span>
                    </div>

                    <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                      {stip.targets.map((target) => (
                        <div key={target} style={targetLine}>{target}</div>
                      ))}
                    </div>

                    {stip.verification?.rejection_reason ? (
                      <div style={rejectReason}>Reason: {stip.verification.rejection_reason}</div>
                    ) : null}
                    {stip.verification?.verified_monthly_income ? (
                      <div style={rejectReason}>
                        Actual verified monthly income: {money(stip.verification.verified_monthly_income)}
                      </div>
                    ) : null}

                    {stip.verification && !stip.is_current ? (
                      <div style={rejectReason}>The deal structure changed after this stip was reviewed.</div>
                    ) : null}
                  </div>

                  <div style={stipActions}>
                    {stip.documents.length ? (
                      <button type="button" style={btnSecondary} onClick={() => onViewDocument(stip.documents[0])}>
                        View
                      </button>
                    ) : (
                      <span style={statusBad}>Missing file</span>
                    )}
                    <button
                      type="button"
                      style={btnSecondary}
                      disabled={!stip.documents.length || !!workingKey}
                      onClick={() =>
                        runFundingAction(
                          { action: "verify_stip", doc_type: stip.doc_type },
                          `${stip.label} verified.`,
                          `verify:${stip.doc_type}`
                        )
                      }
                    >
                      {workingKey === `verify:${stip.doc_type}` ? "Verifying..." : "Verify"}
                    </button>
                    <button
                      type="button"
                      style={btnDanger}
                      disabled={!stip.documents.length || !!workingKey}
                      onClick={() => onRejectStip(stip)}
                    >
                      {workingKey === `reject:${stip.doc_type}` ? "Saving..." : "Did Not Verify"}
                    </button>
                  </div>

                  {stip.documents.length > 1 ? (
                    <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
                      {stip.documents.slice(1).map((doc) => (
                        <div key={doc.id} style={docCard}>
                          <div>
                            <div style={{ fontWeight: 800 }}>{doc.original_name || "Uploaded file"}</div>
                            <div style={docMeta}>
                              {formatDate(doc.created_at)} - {formatBytes(doc.size_bytes)}
                            </div>
                          </div>
                          <button type="button" style={btnSecondary} onClick={() => onViewDocument(doc)}>
                            View
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <div style={gridTwo}>
            <section style={card}>
              <div style={sectionTitle}>Funding Notes</div>
              <div style={noteBox}>{fundSummary.deal?.funding_notes?.trim() || "No funding notes."}</div>
            </section>

            <section style={card}>
              <div style={sectionTitle}>Funding Decision</div>
              <div style={noteBox}>
                {fundSummary.deal?.funding_decision_notes?.trim() || "No funding decision notes."}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

function stipStatusText(stip: FundingStip) {
  if (!stip.documents.length) return "Missing";
  if (!stip.verification) return "Needs review";
  if (!stip.is_current) return "Stale";
  return stip.verification.status === "verified" ? "Verified" : "Not verified";
}

function statusPill(stip: FundingStip): React.CSSProperties {
  const text = stipStatusText(stip);
  const isGood = text === "Verified";
  const isBad = text === "Missing" || text === "Not verified" || text === "Stale";
  return {
    fontSize: 11,
    fontWeight: 900,
    padding: "3px 8px",
    borderRadius: 999,
    background: isGood ? "#f2fff2" : isBad ? "#fff3f3" : "#f4f4f4",
    color: isGood ? "green" : isBad ? "crimson" : "#666",
    border: `1px solid ${isGood ? "#cfe9cf" : isBad ? "#f1c7c7" : "#e0e0e0"}`,
  };
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 10, alignItems: "center" }}>
      <div style={{ fontWeight: 900, color: ok ? "green" : "crimson" }}>{ok ? "Yes" : "No"}</div>
      <div style={{ fontWeight: 800 }}>{label}</div>
    </div>
  );
}

const headerRow: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
};

const gridTwo: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
  gap: 14,
};

const card: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  borderRadius: 8,
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

const helperText: React.CSSProperties = {
  fontSize: 12,
  color: "#666",
  marginTop: 8,
  lineHeight: 1.45,
};

const stipRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: 12,
  alignItems: "start",
  padding: 12,
  border: "1px solid #ececec",
  borderRadius: 8,
  background: "#fcfcfc",
};

const stipActions: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const targetLine: React.CSSProperties = {
  fontSize: 13,
  color: "#333",
  fontWeight: 700,
};

const rejectReason: React.CSSProperties = {
  marginTop: 10,
  padding: 10,
  borderRadius: 8,
  border: "1px solid #f1b5b5",
  background: "#fff3f3",
  color: "crimson",
  fontSize: 13,
  fontWeight: 800,
};

const docCard: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  border: "1px solid #ececec",
  borderRadius: 8,
  padding: 10,
  background: "#fff",
};

const docMeta: React.CSSProperties = {
  fontSize: 12,
  color: "#666",
  marginTop: 2,
};

const noteBox: React.CSSProperties = {
  minHeight: 110,
  whiteSpace: "pre-wrap",
  border: "1px solid #ececec",
  borderRadius: 8,
  padding: 12,
  background: "#fcfcfc",
  fontSize: 14,
  lineHeight: 1.5,
  fontWeight: 700,
  color: "#333",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  fontWeight: 900,
};

const btnSecondary: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 900,
};

const btnDanger: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #f1b5b5",
  background: "#fff3f3",
  color: "crimson",
  cursor: "pointer",
  fontWeight: 900,
};

const infoBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 8,
  border: "1px solid #e5e5e5",
  background: "#fafafa",
  fontWeight: 700,
};

const errorBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 8,
  border: "1px solid #f1b5b5",
  background: "#fff3f3",
  color: "crimson",
  fontWeight: 900,
};

const successBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 8,
  border: "1px solid #cfe9cf",
  background: "#f2fff2",
  color: "green",
  fontWeight: 900,
};

const statusBad: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 900,
  color: "crimson",
};
