"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type DocType = "credit_app" | "credit_bureau";

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

export default function CustomerDocuments({
  dealId,
  onStatus,
}: {
  dealId: string;
  onStatus?: (s: { credit_app: boolean; credit_bureau: boolean }) => void;
}) {
  const [docs, setDocs] = useState<{
    credit_app: DealDoc | null;
    credit_bureau: DealDoc | null;
  }>({
    credit_app: null,
    credit_bureau: null,
  });

  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState<DocType | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // New: bureau processing status
  const [bureauStatus, setBureauStatus] = useState<BureauJobStatus>(null);
  const [bureauError, setBureauError] = useState<string | null>(null);
  const [bureauUpdatedAt, setBureauUpdatedAt] = useState<string | null>(null);

  const refreshTimer = useRef<number | null>(null);

  function pushStatus(nextDocs: {
    credit_app: DealDoc | null;
    credit_bureau: DealDoc | null;
  }) {
    onStatus?.({
      credit_app: !!nextDocs.credit_app,
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

  async function fetchBureauStatus() {
    if (!dealId) return;

    try {
      const r = await fetch(`/api/deals/${dealId}/credit-bureau-status`, { cache: "no-store" });
      const j = await r.json();

      if (!r.ok) {
        // don’t hard-fail the whole component if status endpoint isn’t ready
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

  async function refresh() {
    if (!dealId) return;
    setLoading(true);
    setErr(null);

    try {
      const r = await fetch(`/api/deals/${dealId}/documents`, { cache: "no-store" });
      const j = await r.json();

      if (!r.ok) throw new Error(j?.details || j?.error || "Failed to load documents");

      const nextDocs = {
        credit_app: (j.documents?.credit_app ?? null) as DealDoc | null,
        credit_bureau: (j.documents?.credit_bureau ?? null) as DealDoc | null,
      };

      setDocs(nextDocs);
      pushStatus(nextDocs);

      // pull bureau processing status (best-effort)
      await fetchBureauStatus();
    } catch (e: any) {
      setErr(e?.message || "Failed to load documents");
      // Still push status so parent gating doesn't get stuck true
      pushStatus({ credit_app: null, credit_bureau: null });
      setDocs({ credit_app: null, credit_bureau: null });
      setBureauStatus(null);
      setBureauError(null);
      setBureauUpdatedAt(null);
    } finally {
      setLoading(false);
    }
  }

  // Auto refresh bureau status while processing
  const shouldPoll = useMemo(() => {
    // If there is no bureau doc uploaded, don’t poll.
    if (!docs.credit_bureau) return false;
    return isProcessingStatus(bureauStatus);
  }, [docs.credit_bureau, bureauStatus]);

  useEffect(() => {
    refresh();

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
      fetchBureauStatus();
    }, 2500);

    return () => {
      if (refreshTimer.current) {
        window.clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [shouldPoll]); // intentionally not including fetchBureauStatus (stable enough)

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
      if (!r.ok) throw new Error(j?.details || j?.error || "Upload failed");

      // Bureau uploads should immediately show as queued
      if (type === "credit_bureau") {
        setBureauStatus("queued");
        setBureauError(null);
      }

      await refresh();
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
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
      if (!r.ok) throw new Error(j?.details || j?.error || "Delete failed");

      // Reset bureau status on delete
      if (type === "credit_bureau") {
        setBureauStatus(null);
        setBureauError(null);
        setBureauUpdatedAt(null);
      }

      await refresh();
    } catch (e: any) {
      setErr(e?.message || "Delete failed");
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

  function label(t: DocType) {
    return t === "credit_app" ? "Credit Application (PDF)" : "Credit Bureau (PDF)";
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
            {bureauError || err}
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

    return (
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 900 }}>{label(type)}</div>
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

        {/* NEW: show bureau processing status */}
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

          {/* Optional: manual refresh */}
          <button
            type="button"
            style={{
              ...btnSecondary,
              opacity: busy ? 0.6 : 1,
              cursor: busy ? "not-allowed" : "pointer",
            }}
            disabled={busy}
            onClick={() => refresh()}
            title="Refresh document + bureau status"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Documents</h3>
        {err ? <span style={{ color: "crimson" }}>{err}</span> : null}
      </div>

      <DocCard type="credit_app" />
      <DocCard type="credit_bureau" />
    </div>
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