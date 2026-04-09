"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type DocType = "credit_bureau";

type DealDoc = {
  id: string;
  doc_type: DocType;
  original_name: string | null;
  size_bytes: number | null;
  created_at: string;
};

type BureauJobStatus =
  | "queued"
  | "uploaded"
  | "parsing"
  | "redacting"
  | "scoring"
  | "done"
  | "failed"
  | null;

type BureauReport = {
  id: string;
  deal_id: string;
  latest_job_id: string | null;
  bureau: string | null;
  raw_bucket: string | null;
  raw_path: string | null;
  redacted_bucket: string | null;
  redacted_path: string | null;
  redacted_text: string | null;
  created_at: string;
  updated_at: string;
} | null;

type BureauSummary = {
  id: string;
  deal_id: string;
  credit_report_id: string | null;
  job_id: string | null;
  bureau_source: string | null;
  score: number | null;
  total_tradelines: number | null;
  open_tradelines: number | null;
  open_auto_trade: boolean | null;
  months_since_repo: number | null;
  months_since_bankruptcy: number | null;
  total_collections: number | null;
  total_chargeoffs: number | null;
  past_due_amount: number | null;
  utilization_pct: number | null;
  oldest_trade_months: number | null;
  autos_on_bureau: number | null;
  open_auto_trades: number | null;
  paid_auto_trades: number | null;
  repo_count: number | null;
  risk_tier: string | null;
  max_term_months: number | null;
  min_cash_down: number | null;
  max_pti: number | null;
  hard_stop: boolean | null;
  hard_stop_reason: string | null;
  stips: unknown;
  bureau_raw: unknown;
  created_at: string;
  updated_at: string;
} | null;

type ApiErrorLike = {
  details?: string;
  error?: string;
  message?: string;
};

type BureauStatusResponse = {
  status?: BureauJobStatus;
  error_message?: string | null;
  created_at?: string | null;
};

type DocumentsResponse = {
  documents?: {
    credit_bureau?: DealDoc | null;
  };
} & ApiErrorLike;

type BureauTradeline = {
  id: string;
  creditor_name: string | null;
  account_type: string | null;
  account_status: string | null;
  condition_code: string | null;
  amount: number | null;
  balance: number | null;
  credit_limit: number | null;
  monthly_payment: number | null;
  past_due_amount: number | null;
  high_balance: number | null;
  opened_date: string | null;
  last_activity_date: string | null;
  last_payment_date: string | null;
  no_effect: boolean | null;
  good: boolean | null;
  bad: boolean | null;
  auto_repo: boolean | null;
  unpaid_collection: boolean | null;
  unpaid_chargeoff: boolean | null;
  is_auto: boolean | null;
  is_revolving: boolean | null;
  is_installment: boolean | null;
};

type BureauPublicRecord = {
  id: string;
  court_name: string | null;
  record_type: string | null;
  plaintiff: string | null;
  amount: number | null;
  status: string | null;
  filed_date: string | null;
  resolved_date: string | null;
  no_effect: boolean | null;
  good: boolean | null;
  bad: boolean | null;
};

type BureauMessage = {
  id: string;
  message_type: string | null;
  code: string | null;
  message_text: string;
  severity: string | null;
};

type BureauDetailsResponse = {
  ok: true;
  report: BureauReport;
  summary: BureauSummary;
  tradelines: BureauTradeline[];
  publicRecords: BureauPublicRecord[];
  messages: BureauMessage[];
};

type ModalTab = "report" | "info" | "tradelines" | "public";

export default function CustomerDocuments({
  dealId,
  onStatus,
}: {
  dealId: string;
  onStatus?: (s: { credit_app: boolean; credit_bureau: boolean }) => void;
}) {
  const [docs, setDocs] = useState<{
    credit_bureau: DealDoc | null;
  }>({
    credit_bureau: null,
  });

  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState<DocType | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [bureauStatus, setBureauStatus] = useState<BureauJobStatus>(null);
  const [bureauError, setBureauError] = useState<string | null>(null);
  const [bureauUpdatedAt, setBureauUpdatedAt] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<ModalTab>("info");
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [details, setDetails] = useState<BureauDetailsResponse | null>(null);

  const refreshTimer = useRef<number | null>(null);

  function pushStatus(nextDocs: {
    credit_bureau: DealDoc | null;
  }) {
    onStatus?.({
      credit_app: false,
      credit_bureau: !!nextDocs.credit_bureau,
    });
  }

  function isProcessingStatus(s: BureauJobStatus) {
    return s === "queued" || s === "uploaded" || s === "parsing" || s === "redacting" || s === "scoring";
  }

  function bureauStatusText(s: BureauJobStatus) {
    if (!s) return "—";
    if (s === "queued") return "Queued";
    if (s === "uploaded") return "Uploaded";
    if (s === "parsing") return "Parsing";
    if (s === "redacting") return "Redacting";
    if (s === "scoring") return "Scoring";
    if (s === "done") return "Done ✓";
    if (s === "failed") return "Failed";
    return String(s);
  }

  function cleanErrorMessage(value: unknown, fallback = "Something went wrong") {
    if (!value) return fallback;
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      const v = value as ApiErrorLike;
      return v.details || v.error || v.message || JSON.stringify(v);
    }
    return String(value);
  }

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
  }

  async function fetchBureauStatus() {
    if (!dealId) return;

    try {
      const r = await fetch(`/api/deals/${dealId}/credit-bureau-status`, { cache: "no-store" });
      const j = (await r.json()) as BureauStatusResponse;

      if (!r.ok) {
        setBureauStatus(null);
        setBureauError(null);
        setBureauUpdatedAt(null);
        return;
      }

      setBureauStatus((j.status ?? null) as BureauJobStatus);
      setBureauError((j.error_message ?? null) as string | null);
      setBureauUpdatedAt((j.created_at ?? null) as string | null);
    } catch {
      setBureauStatus(null);
      setBureauError(null);
      setBureauUpdatedAt(null);
    }
  }

  async function refreshUnderwriting() {
    if (!dealId) return;

    setBusyType("credit_bureau");
    setErr(null);

    try {
      const r = await fetch(`/api/deals/${dealId}/refresh-underwriting`, {
        method: "POST",
      });

      const j = await r.json();
      if (!r.ok) throw new Error(cleanErrorMessage(j, "Failed to refresh underwriting"));

      await refresh();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Failed to refresh underwriting"));
    } finally {
      setBusyType(null);
    }
  }

  async function refresh() {
    if (!dealId) return;
    setLoading(true);
    setErr(null);

    try {
      const r = await fetch(`/api/deals/${dealId}/documents`, { cache: "no-store" });
      const j = (await r.json()) as DocumentsResponse;

      if (!r.ok) throw new Error(j?.details || j?.error || "Failed to load documents");

      const nextDocs = {
        credit_bureau: (j.documents?.credit_bureau ?? null) as DealDoc | null,
      };

      setDocs(nextDocs);
      pushStatus(nextDocs);
      await fetchBureauStatus();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Failed to load documents"));
      pushStatus({ credit_bureau: null });
      setDocs({ credit_bureau: null });
      setBureauStatus(null);
      setBureauError(null);
      setBureauUpdatedAt(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadBureauDetails(openWithTab: ModalTab = "info") {
    setDetailsLoading(true);
    setDetailsError(null);
    setModalTab(openWithTab);
    setModalOpen(true);

    try {
      const r = await fetch(`/api/deals/${dealId}/credit-bureau-details`, {
        cache: "no-store",
      });
      const j = await r.json();

      if (!r.ok) {
        throw new Error(cleanErrorMessage(j, "Failed to load bureau details"));
      }

      setDetails(j as BureauDetailsResponse);
    } catch (e: unknown) {
      setDetails(null);
      setDetailsError(errorMessage(e, "Failed to load bureau details"));
    } finally {
      setDetailsLoading(false);
    }
  }

  const shouldPoll = useMemo(() => {
    if (!docs.credit_bureau) return false;
    return isProcessingStatus(bureauStatus);
  }, [docs.credit_bureau, bureauStatus]);

  useEffect(() => {
    void refresh();

    return () => {
      if (refreshTimer.current) {
        window.clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => {
    if (refreshTimer.current) {
      window.clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }

    if (!shouldPoll) return;

    refreshTimer.current = window.setInterval(() => {
      void fetchBureauStatus();
    }, 2500);

    return () => {
      if (refreshTimer.current) {
        window.clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPoll]);

  function isPdf(file: File) {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    return name.endsWith(".pdf") || type === "application/pdf";
  }

  async function upload(type: DocType, file: File) {
    setBusyType(type);
    setErr(null);

    try {
      if (!isPdf(file)) throw new Error("PDF only");

      const fd = new FormData();
      fd.append("doc_type", type);
      fd.append("file", file);

      const r = await fetch(`/api/deals/${dealId}/documents`, {
        method: "POST",
        body: fd,
      });

      const j = await r.json();
      if (!r.ok) throw new Error(cleanErrorMessage(j, "Upload failed"));

      if (type === "credit_bureau") {
        setBureauStatus("queued");
        setBureauError(null);
        setDetails(null);
      }

      await refresh();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Upload failed"));
    } finally {
      setBusyType(null);
    }
  }

  async function remove(type: DocType) {
    const doc = docs[type];
    if (!doc?.id) return;

    setBusyType(type);
    setErr(null);

    try {
      const r = await fetch(`/api/deals/${dealId}/documents/${doc.id}`, {
        method: "DELETE",
      });

      const j = await r.json();
      if (!r.ok) throw new Error(cleanErrorMessage(j, "Delete failed"));

      if (type === "credit_bureau") {
        setBureauStatus(null);
        setBureauError(null);
        setBureauUpdatedAt(null);
        setDetails(null);
        setModalOpen(false);
      }

      await refresh();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Delete failed"));
    } finally {
      setBusyType(null);
    }
  }

  function prettyBytes(n?: number | null) {
    const v = Number(n ?? 0);
    if (!v) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let x = v;
    while (x >= 1024 && i < units.length - 1) {
      x /= 1024;
      i++;
    }
    return `${x.toFixed(1)} ${units[i]}`;
  }

  function label() {
    return "Credit Bureau (PDF)";
  }

  function BureauStatusPill() {
    const s = bureauStatus;
    if (!docs.credit_bureau) return null;

    const txt = bureauStatusText(s);
    const isBad = s === "failed";
    const isGood = s === "done";
    const isBusy = isProcessingStatus(s);

    const bg = isGood ? "#E7F7EE" : isBad ? "#FFE9E9" : isBusy ? "#EEF2FF" : "#F3F4F6";
    const border = isGood ? "#86EFAC" : isBad ? "#FCA5A5" : isBusy ? "#A5B4FC" : "#E5E7EB";
    const color = isGood ? "#166534" : isBad ? "#991B1B" : isBusy ? "#1E3A8A" : "#374151";

    return (
      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 999,
            border: `1px solid ${border}`,
            background: bg,
            color,
            fontWeight: 800,
            width: "fit-content",
            fontSize: 12,
          }}
        >
          Status: {txt}
          {isBusy ? <span style={{ opacity: 0.75 }}>…</span> : null}
        </div>

        {s === "failed" && (bureauError || err) ? (
          <div style={{ color: "crimson", fontSize: 12 }}>
            {cleanErrorMessage(bureauError || err)}
          </div>
        ) : null}

        {bureauUpdatedAt ? (
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Updated:{" "}
            {new Date(bureauUpdatedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </div>
        ) : null}
      </div>
    );
  }

  function DocCard({ type }: { type: DocType }) {
    const doc = docs[type];
    const busy = busyType === type;
    const bureauReady = type === "credit_bureau" && bureauStatus === "done";

    return (
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 900 }}>{label()}</div>
          <div style={{ flex: 1 }} />
          {loading ? <span style={{ opacity: 0.7 }}>Loading…</span> : null}
          {busy ? <span style={{ opacity: 0.7 }}>Working…</span> : null}
        </div>

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
          {doc ? (
            <>
              <div>
                <b>Uploaded:</b>{" "}
                {new Date(doc.created_at).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </div>
              <div>
                <b>File:</b> {doc.original_name ?? "upload.pdf"}{" "}
                <span style={{ opacity: 0.7 }}>({prettyBytes(doc.size_bytes)})</span>
              </div>
            </>
          ) : (
            <div style={{ opacity: 0.75 }}>No file uploaded yet.</div>
          )}
        </div>

        {type === "credit_bureau" ? <BureauStatusPill /> : null}

        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <label
            style={{
              ...btnPrimary,
              opacity: busy ? 0.6 : 1,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            <input
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: "none" }}
              disabled={busy}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (!f) return;
                upload(type, f);
              }}
            />
            {doc ? "Replace PDF" : "Upload PDF"}
          </label>

          <button
            type="button"
            style={{
              ...btnDanger,
              opacity: busy || !doc ? 0.6 : 1,
              cursor: busy || !doc ? "not-allowed" : "pointer",
            }}
            disabled={busy || !doc}
            onClick={() => remove(type)}
          >
            Remove
          </button>

          <button
            type="button"
            style={{
              ...btnSecondary,
              opacity: busy ? 0.6 : 1,
              cursor: busy ? "not-allowed" : "pointer",
            }}
            disabled={busy}
            onClick={() => refreshUnderwriting()}
            title="Refresh underwriting from current bureau data"
          >
            Refresh Underwriting
          </button>

          {type === "credit_bureau" ? (
            <button
              type="button"
              style={{
                ...btnSecondary,
                opacity: bureauReady ? 1 : 0.6,
                cursor: bureauReady ? "pointer" : "not-allowed",
              }}
              disabled={!bureauReady}
              onClick={() => loadBureauDetails("info")}
              title={bureauReady ? "View parsed bureau details" : "Available after processing completes"}
            >
              More Info
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Documents</h3>
          {err ? <span style={{ color: "crimson" }}>{err}</span> : null}
        </div>

        <DocCard type="credit_bureau" />
      </div>

      {modalOpen ? (
        <BureauDetailsModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          activeTab={modalTab}
          onTabChange={setModalTab}
          loading={detailsLoading}
          error={detailsError}
          details={details}
        />
      ) : null}
    </>
  );
}

function BureauDetailsModal({
  open,
  onClose,
  activeTab,
  onTabChange,
  loading,
  error,
  details,
}: {
  open: boolean;
  onClose: () => void;
  activeTab: ModalTab;
  onTabChange: (tab: ModalTab) => void;
  loading: boolean;
  error: string | null;
  details: BureauDetailsResponse | null;
}) {
  if (!open) return null;

  const summary = details?.summary ?? null;
  const report = details?.report ?? null;
  const tradelines = details?.tradelines ?? [];
  const publicRecords = details?.publicRecords ?? [];
  const messages = details?.messages ?? [];

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>Additional Credit Info</div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={closeBtn}>
            ×
          </button>
        </div>

        <div style={tabBar}>
          <TabButton label="Credit Report" active={activeTab === "report"} onClick={() => onTabChange("report")} />
          <TabButton label="Credit Info" active={activeTab === "info"} onClick={() => onTabChange("info")} />
          <TabButton label="Trade Line" active={activeTab === "tradelines"} onClick={() => onTabChange("tradelines")} />
          <TabButton label="Public Record" active={activeTab === "public"} onClick={() => onTabChange("public")} />
        </div>

        <div style={modalBody}>
          {loading ? <div>Loading bureau details…</div> : null}
          {!loading && error ? <div style={{ color: "crimson" }}>{error}</div> : null}

          {!loading && !error && activeTab === "report" ? (
            <ReportTab report={report} messages={messages} />
          ) : null}

          {!loading && !error && activeTab === "info" ? (
            <InfoTab summary={summary} messages={messages} />
          ) : null}

          {!loading && !error && activeTab === "tradelines" ? (
            <TradelinesTab tradelines={tradelines} />
          ) : null}

          {!loading && !error && activeTab === "public" ? (
            <PublicRecordsTab publicRecords={publicRecords} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "10px 14px",
        border: "none",
        borderBottom: active ? "2px solid #2563EB" : "2px solid transparent",
        background: "transparent",
        color: active ? "#111" : "#2563EB",
        fontWeight: active ? 800 : 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function ReportTab({
  report,
  messages,
}: {
  report: BureauReport;
  messages: BureauMessage[];
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
        <div><b>Bureau:</b> {report?.bureau ?? "—"}</div>
        <div><b>Report ID:</b> {report?.id ?? "—"}</div>
      </div>

      {messages.length > 0 ? (
        <div style={{ display: "grid", gap: 8 }}>
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #E5E7EB",
                background: "#FAFAFA",
                fontSize: 13,
              }}
            >
              <b>{m.message_type ?? "note"}:</b> {m.message_text}
              {m.code ? <span style={{ opacity: 0.65 }}> ({m.code})</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          fontSize: 12,
          lineHeight: 1.5,
          background: "#F8FAFC",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: 14,
          maxHeight: 420,
          overflow: "auto",
        }}
      >
        {report?.redacted_text || "No redacted report text available."}
      </pre>
    </div>
  );
}

function InfoTab({
  summary,
  messages,
}: {
  summary: BureauSummary;
  messages: BureauMessage[];
}) {
  const scoreFactors = messages.filter((m) => m.message_type === "score_factor");
  const alerts = messages.filter((m) => m.message_type !== "score_factor");

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={sectionCard}>
          <div style={sectionTitle}>Auto Scored Information</div>
          <InfoRow label="Score" value={summary?.score} />
          <InfoRow label="Total Tradelines" value={summary?.total_tradelines} />
          <InfoRow label="Open Tradelines" value={summary?.open_tradelines} />
          <InfoRow label="Open Auto Trade" value={yesNo(summary?.open_auto_trade)} />
          <InfoRow label="Total Collections" value={money(summary?.total_collections)} />
          <InfoRow label="Total Chargeoffs" value={money(summary?.total_chargeoffs)} />
          <InfoRow label="Past Due Amount" value={money(summary?.past_due_amount)} />
        </div>

        <div style={sectionCard}>
          <div style={sectionTitle}>Credit Information</div>
          <InfoRow label="Utilization" value={pct(summary?.utilization_pct)} />
          <InfoRow label="Oldest Trade" value={months(summary?.oldest_trade_months)} />
          <InfoRow label="Autos on Bureau" value={summary?.autos_on_bureau} />
          <InfoRow label="Open Autos" value={summary?.open_auto_trades} />
          <InfoRow label="Paid Autos" value={summary?.paid_auto_trades} />
          <InfoRow label="Number of Repos" value={summary?.repo_count} />
          <InfoRow label="Months Since Repo" value={months(summary?.months_since_repo)} />
          <InfoRow label="Months Since Bankruptcy" value={months(summary?.months_since_bankruptcy)} />
          <InfoRow label="Risk Tier" value={summary?.risk_tier ?? "—"} />
          <InfoRow label="Hard Stop" value={yesNo(summary?.hard_stop)} />
          <InfoRow label="Hard Stop Reason" value={summary?.hard_stop_reason ?? "—"} />
        </div>
      </div>

      {alerts.length > 0 ? (
        <div style={sectionCard}>
          <div style={sectionTitle}>Alerts / Notes</div>
          <div style={{ display: "grid", gap: 8 }}>
            {alerts.map((m) => (
              <div key={m.id} style={{ fontSize: 13 }}>
                <b>{m.message_type ?? "note"}:</b> {m.message_text}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {scoreFactors.length > 0 ? (
        <div style={sectionCard}>
          <div style={sectionTitle}>Score Factors</div>
          <div style={{ display: "grid", gap: 8 }}>
            {scoreFactors.map((m) => (
              <div key={m.id} style={{ fontSize: 13 }}>
                • {m.message_text}
                {m.code ? <span style={{ opacity: 0.65 }}> ({m.code})</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TradelinesTab({ tradelines }: { tradelines: BureauTradeline[] }) {
  if (!tradelines.length) {
    return <div>No tradelines available.</div>;
  }

  return (
    <div style={{ overflow: "auto", maxHeight: 480, border: "1px solid #E5E7EB", borderRadius: 12 }}>
      <table style={table}>
        <thead>
          <tr>
            <Th>Creditor</Th>
            <Th>Type</Th>
            <Th>Status</Th>
            <Th>Amount</Th>
            <Th>No Effect</Th>
            <Th>Good</Th>
            <Th>Bad</Th>
            <Th>Auto Repo</Th>
            <Th>Unpaid Coll</Th>
            <Th>Unpaid Charge Off</Th>
          </tr>
        </thead>
        <tbody>
          {tradelines.map((t) => (
            <tr key={t.id}>
              <Td>{t.creditor_name ?? "—"}</Td>
              <Td>{t.account_type ?? "—"}</Td>
              <Td>{t.account_status ?? "—"}</Td>
              <Td>{money(t.amount ?? t.balance)}</Td>
              <Td>{check(t.no_effect)}</Td>
              <Td>{check(t.good)}</Td>
              <Td>{check(t.bad)}</Td>
              <Td>{check(t.auto_repo)}</Td>
              <Td>{check(t.unpaid_collection)}</Td>
              <Td>{check(t.unpaid_chargeoff)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PublicRecordsTab({
  publicRecords,
}: {
  publicRecords: BureauPublicRecord[];
}) {
  if (!publicRecords.length) {
    return <div>No records available.</div>;
  }

  return (
    <div style={{ overflow: "auto", maxHeight: 480, border: "1px solid #E5E7EB", borderRadius: 12 }}>
      <table style={table}>
        <thead>
          <tr>
            <Th>Court Name</Th>
            <Th>Type</Th>
            <Th>Plaintiff</Th>
            <Th>Amount</Th>
            <Th>Status</Th>
            <Th>No Effect</Th>
            <Th>Good</Th>
            <Th>Bad</Th>
          </tr>
        </thead>
        <tbody>
          {publicRecords.map((r) => (
            <tr key={r.id}>
              <Td>{r.court_name ?? "—"}</Td>
              <Td>{r.record_type ?? "—"}</Td>
              <Td>{r.plaintiff ?? "—"}</Td>
              <Td>{money(r.amount)}</Td>
              <Td>{r.status ?? "—"}</Td>
              <Td>{check(r.no_effect)}</Td>
              <Td>{check(r.good)}</Td>
              <Td>{check(r.bad)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
      <div>{label}</div>
      <div style={{ fontWeight: 700, textAlign: "right" }}>{value ?? "—"}</div>
    </div>
  );
}

function money(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `$${Number(v).toLocaleString()}`;
}

function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `${v}%`;
}

function months(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `${v} mo`;
}

function yesNo(v: boolean | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v ? "Yes" : "No";
}

function check(v: boolean | null | undefined) {
  if (v === null || v === undefined) return "";
  return v ? "✓" : "";
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderBottom: "1px solid #E5E7EB",
        fontSize: 12,
        background: "#F9FAFB",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid #F1F5F9",
        fontSize: 13,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 14,
  padding: 14,
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  fontWeight: 800,
};

const btnSecondary: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
  color: "#111",
  fontWeight: 800,
};

const btnDanger: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
  color: "crimson",
  fontWeight: 800,
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
  padding: 24,
};

const modal: React.CSSProperties = {
  width: "min(1100px, 96vw)",
  maxHeight: "88vh",
  overflow: "hidden",
  background: "#fff",
  borderRadius: 16,
  border: "1px solid #E5E7EB",
  boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  display: "flex",
  flexDirection: "column",
  padding: 18,
};

const closeBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 28,
  lineHeight: 1,
  cursor: "pointer",
  color: "#666",
};

const tabBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  borderBottom: "1px solid #E5E7EB",
  marginTop: 10,
};

const modalBody: React.CSSProperties = {
  paddingTop: 16,
  overflow: "auto",
};

const sectionCard: React.CSSProperties = {
  border: "1px solid #E5E7EB",
  borderRadius: 12,
  padding: 14,
  display: "grid",
  gap: 10,
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 14,
  marginBottom: 4,
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};
