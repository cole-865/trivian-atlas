"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { DealStep } from "@/lib/deals/canAccessStep";

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
  cash_down: number | null;
};

type DealStructure = {
  deal_id: string;
  vehicle_id: string;
  option_label: string;
  include_vsc: boolean;
  include_gap: boolean;
  term_months: number;
  monthly_payment: number;
  ltv: number;
  pti: number;
  cash_down: number | null;
};

type DealStructureResponse = {
  ok: boolean;
  details?: string;
  error?: string;
  reason?: string;
  redirectTo?: DealStep;
  deal_id: string;
  structure: {
    selection: Selection;
    structure: DealStructure;
  } | null;
  overrides?: {
    effectiveBlockers: string[];
  };
};

type DocumentsErrorResponse = {
  ok: false;
  documents: null;
  details?: string;
  error?: string;
};

type DealStructureErrorResponse = {
  ok: false;
  deal_id: string;
  structure: null;
  details?: string;
  error?: string;
  reason?: string;
  redirectTo?: DealStep;
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

type DocumentsResponse = {
  ok: boolean;
  details?: string;
  error?: string;
  documents: {
    credit_bureau: DealDocument | null;
    proof_of_income: DealDocument[];
    proof_of_residence: DealDocument[];
    driver_license: DealDocument[];
    insurance: DealDocument[];
    references: DealDocument[];
    other: DealDocument[];
  };
};

type StipConfig = {
  key:
  | "proof_of_income"
  | "proof_of_residence"
  | "driver_license"
  | "insurance"
  | "references"
  | "other";
  label: string;
  required: boolean;
  helper: string;
  allowMultiple: boolean;
};

const STIP_CONFIG: StipConfig[] = [
  {
    key: "proof_of_income",
    label: "Proof of Income",
    required: true,
    helper: "Pay stubs, bank statements, benefit letter, or other income proof.",
    allowMultiple: true,
  },
  {
    key: "proof_of_residence",
    label: "Proof of Residence",
    required: true,
    helper: "Utility bill, lease, mail, or other address verification.",
    allowMultiple: true,
  },
  {
    key: "driver_license",
    label: "Driver License",
    required: true,
    helper: "Front/back images or a PDF scan.",
    allowMultiple: true,
  },
  {
    key: "insurance",
    label: "Insurance",
    required: false,
    helper: "Insurance card, binder, or declarations page.",
    allowMultiple: true,
  },
  {
    key: "references",
    label: "References",
    required: false,
    helper: "Reference sheet or supporting contact documentation.",
    allowMultiple: true,
  },
  {
    key: "other",
    label: "Other",
    required: false,
    helper: "Anything else needed to fund or explain the deal.",
    allowMultiple: true,
  },
];

function money(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function yesNo(v: boolean) {
  return v ? "Yes" : "No";
}

function formatBytes(bytes: number | null | undefined) {
  const value = Number(bytes ?? 0);
  if (!value) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: string | null | undefined) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function DealSubmitPage() {
  const params = useParams();
  const router = useRouter();
  const dealId = asString(params?.dealId);

  const [loading, setLoading] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [structure, setStructure] = useState<DealStructure | null>(null);
  const [documents, setDocuments] = useState<DocumentsResponse["documents"] | null>(null);
  const [effectiveBlockers, setEffectiveBlockers] = useState<string[]>([]);

  const [submitNotes, setSubmitNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragDocType, setDragDocType] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!dealId) return;

    let cancelled = false;

    async function loadSavedStructure() {
      const r = await fetch(`/api/deals/${dealId}/deal-structure`, {
        cache: "no-store",
      });

      const j: DealStructureResponse | DealStructureErrorResponse = await r.json().catch(() => ({
        ok: false,
        deal_id: dealId,
        structure: null,
      }));

      if (!r.ok) {
        if ("error" in j && j.error === "STEP_BLOCKED" && j.redirectTo) {
          router.replace(`/deals/${dealId}/${j.redirectTo}`);
          return;
        }

        throw new Error(
          ("details" in j && j.details) || ("error" in j && j.error) || "Failed to load structure"
        );
      }

      const successResponse = j as DealStructureResponse;

      if (!cancelled) {
        setSelection(successResponse.structure?.selection ?? null);
        setStructure(successResponse.structure?.structure ?? null);
        setEffectiveBlockers(successResponse.overrides?.effectiveBlockers ?? []);
      }
    }

    async function loadDocuments() {
      const r = await fetch(`/api/deals/${dealId}/documents`, {
        cache: "no-store",
      });

      const j: DocumentsResponse | DocumentsErrorResponse = await r.json().catch(() => ({
        ok: false,
        documents: null,
      }));

      if (!r.ok) {
        throw new Error(j.details || j.error || "Failed to load documents");
      }

      if (!cancelled) {
        setDocuments(j.documents);
      }
    }

    async function loadAll() {
      setLoading(true);
      setLoadingDocs(true);
      setErr(null);

      try {
        await Promise.all([loadSavedStructure(), loadDocuments()]);
      } catch (error: unknown) {
        if (!cancelled) {
          setErr(error instanceof Error ? error.message : "Load failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingDocs(false);
        }
      }
    }

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, [dealId, router]);

  async function refreshDocuments() {
    if (!dealId) return;

    setLoadingDocs(true);

    try {
      const r = await fetch(`/api/deals/${dealId}/documents`, {
        cache: "no-store",
      });

      const j: DocumentsResponse | DocumentsErrorResponse = await r.json().catch(() => ({
        ok: false,
        documents: null,
      }));

      if (!r.ok) {
        throw new Error(j.details || j.error || "Failed to refresh documents");
      }

      setDocuments(j.documents);
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : "Failed to refresh documents");
    } finally {
      setLoadingDocs(false);
    }
  }

  const requiredStipsComplete = useMemo(() => {
    if (!documents) return false;

    return STIP_CONFIG.filter((x) => x.required).every((stip) => {
      const files = documents[stip.key] ?? [];
      return files.length > 0;
    });
  }, [documents]);

  const blockingItems = useMemo(() => {
    const blockers: string[] = [];

    if (!selection || !structure) blockers.push("Missing saved structure.");
    if (!documents?.credit_bureau) blockers.push("Missing credit bureau PDF.");
    if (!requiredStipsComplete) blockers.push("Missing one or more required stip docs.");
    if (effectiveBlockers.length) {
      blockers.push(`Program blockers unresolved: ${effectiveBlockers.join(", ")}`);
    }

    return blockers;
  }, [selection, structure, documents, requiredStipsComplete, effectiveBlockers]);

  const checklistItems = useMemo(() => {
    const creditBureauPresent = !!documents?.credit_bureau;

    return [
      {
        ok: !!selection,
        label: "Vehicle selected",
        detail: !!selection
          ? "A vehicle has been saved for this deal."
          : "No selected vehicle found.",
      },
      {
        ok: !!structure,
        label: "Structure selected",
        detail: !!structure
          ? "Payment option, term, and down payment are present."
          : "No saved structure found.",
      },
      {
        ok: creditBureauPresent,
        label: "Credit bureau uploaded",
        detail: creditBureauPresent
          ? "A bureau file exists for this deal."
          : "No credit bureau file found.",
      },
      {
        ok: requiredStipsComplete,
        label: "Required stipulations uploaded",
        detail: requiredStipsComplete
          ? "Required stip docs are present."
          : "Missing one or more required stips.",
      },
      {
        ok: effectiveBlockers.length === 0,
        label: "Program blockers resolved",
        detail:
          effectiveBlockers.length === 0
            ? "No unresolved program blockers remain."
            : `Still blocked by: ${effectiveBlockers.join(", ")}`,
      },
      {
        ok: submitted,
        label: "Deal submitted",
        detail: submitted
          ? "Step 5 submit completed successfully."
          : "Deal has not been submitted yet.",
      },
    ];
  }, [selection, structure, documents, requiredStipsComplete, effectiveBlockers, submitted]);

  const readyCount = checklistItems.filter((x) => x.ok).length;
  const totalCount = checklistItems.length;

  const canSubmit = useMemo(() => {
    return (
      !!selection &&
      !!structure &&
      !!documents?.credit_bureau &&
      requiredStipsComplete &&
      effectiveBlockers.length === 0
    );
  }, [selection, structure, documents, requiredStipsComplete, effectiveBlockers]);

  function onPrev() {
    router.push(`/deals/${dealId}/deal`);
  }

  function onContinueToFund() {
    router.push(`/deals/${dealId}/fund`);
  }

  async function onSubmitDeal() {
    setErr(null);
    setSubmitSuccess(null);

    if (!canSubmit) {
      setErr(
        "This deal is not ready yet. Make sure the structure, bureau, and required stipulations are all in place."
      );
      return;
    }

    setSubmitting(true);

    try {
      const r = await fetch(`/api/deals/${dealId}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          funding_notes: submitNotes,
          internal_notes: internalNotes,
        }),
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        if (j?.error === "STEP_BLOCKED" && j?.redirectTo) {
          router.replace(`/deals/${dealId}/${j.redirectTo}`);
          return;
        }

        const blockerText =
          Array.isArray(j?.blockers) && j.blockers.length > 0
            ? ` ${j.blockers.join(" • ")}`
            : "";

        throw new Error(j?.details || j?.error || `Submit failed.${blockerText}`);
      }

      setSubmitted(true);
      setSubmitSuccess("Deal submitted successfully. You can continue to funding.");
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Failed to submit deal.");
    } finally {
      setSubmitting(false);
    }
  }

  function openPicker(docType: StipConfig["key"]) {
    setUploadError(null);
    fileInputRefs.current[docType]?.click();
  }

  async function onUploadFile(docType: string, file: File | null) {
    if (!file || !dealId) return;

    setUploadError(null);
    setUploadingDocType(docType);

    try {
      const form = new FormData();
      form.append("doc_type", docType);
      form.append("file", file);

      const r = await fetch(`/api/deals/${dealId}/documents`, {
        method: "POST",
        body: form,
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        if (j?.error === "STEP_BLOCKED" && j?.redirectTo) {
          router.replace(`/deals/${dealId}/${j.redirectTo}`);
          return;
        }

        throw new Error(j?.details || j?.error || "Upload failed");
      }

      await refreshDocuments();
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploadingDocType(null);

      const input = fileInputRefs.current[docType];
      if (input) input.value = "";
    }
  }

  function onDragOverDoc(event: React.DragEvent<HTMLDivElement>, docType: StipConfig["key"]) {
    event.preventDefault();
    if (uploadingDocType) return;
    setDragDocType(docType);
  }

  function onDragLeaveDoc(event: React.DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragDocType((current) => current);
    setDragDocType(null);
  }

  function onDropDoc(event: React.DragEvent<HTMLDivElement>, docType: StipConfig["key"]) {
    event.preventDefault();
    setDragDocType(null);

    if (uploadingDocType) return;

    const file = Array.from(event.dataTransfer.files ?? [])[0] ?? null;
    if (!file) return;
    void onUploadFile(docType, file);
  }

  if (!dealId) {
    return (
      <div style={{ padding: 16, color: "#fca5a5" }}>
        Missing dealId in route params. (Check folder name: <code>deals/[dealId]/submit</code>)
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={headerRow}>
        <div>
          <h2 style={{ margin: 0 }}>Step 5: Review & Submit</h2>
          <div style={{ marginTop: 4, fontSize: 13, color: "rgba(255,255,255,0.62)", fontWeight: 600 }}>
            Final review, required stip uploads, and deal packet assembly.
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <button type="button" onClick={onPrev} style={btnSecondary}>
          ← Previous
        </button>

        {submitted ? (
          <button type="button" onClick={onContinueToFund} style={btnPrimary}>
            Continue to Fund →
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmitDeal}
            disabled={!canSubmit || loading || submitting}
            style={{
              ...btnPrimary,
              background:
                !canSubmit || loading || submitting ? "rgba(148,163,184,0.45)" : "rgb(70,205,255)",
              border: `1px solid ${!canSubmit || loading || submitting ? "rgba(148,163,184,0.45)" : "rgb(70,205,255)"}`,
              color:
                !canSubmit || loading || submitting ? "rgba(255,255,255,0.72)" : "rgb(10,18,30)",
              cursor:
                !canSubmit || loading || submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Submitting..." : "Submit Deal"}
          </button>
        )}
      </div>

      {loading ? <div style={infoBox}>Loading submit review…</div> : null}
      {err ? <div style={errorBox}>{err}</div> : null}
      {uploadError ? <div style={errorBox}>{uploadError}</div> : null}
      {submitSuccess ? <div style={successBox}>{submitSuccess}</div> : null}

      <div style={gridTwo}>
        <section style={card}>
          <div style={sectionTitle}>Preflight Checklist</div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1 }}>
              {readyCount}/{totalCount}
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.62)", fontWeight: 700, marginTop: 4 }}>
              Checks passing
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {checklistItems.map((item) => (
              <ChecklistRow
                key={item.label}
                ok={item.ok}
                label={item.label}
                detail={item.detail}
              />
            ))}
          </div>
        </section>

        <section style={card}>
          <div style={sectionTitle}>Structure Summary</div>

          {selection ? (
            <div style={kvGrid}>
              <div style={k}>Vehicle ID</div>
              <div style={v}>{selection.vehicle_id}</div>

              <div style={k}>Package</div>
              <div style={v}>{selection.option_label}</div>

              <div style={k}>Monthly Payment</div>
              <div style={vStrong}>{structure ? money(structure.monthly_payment) : "—"}</div>

              <div style={k}>LTV</div>
              <div style={vStrong}>
                {structure?.ltv ? `${(Number(structure.ltv) * 100).toFixed(1)}%` : "-"}
              </div>

              <div style={k}>PTI</div>
              <div style={vStrong}>
                {structure?.pti ? `${(Number(structure.pti) * 100).toFixed(1)}%` : "-"}
              </div>

              <div style={k}>Term</div>
              <div style={vStrong}>{structure ? `${structure.term_months} months` : "—"}</div>

              <div style={k}>Cash Down</div>
              <div style={vStrong}>
                {selection.cash_down != null ? money(selection.cash_down) : "—"}
              </div>

              <div style={k}>VSC</div>
              <div style={v}>{yesNo(selection.include_vsc)}</div>

              <div style={k}>GAP</div>
              <div style={v}>{yesNo(selection.include_gap)}</div>
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.62)", lineHeight: 1.5 }}>
              No structure has been saved yet.
            </div>
          )}
        </section>
      </div>

      <section style={card}>
        <div style={sectionTitle}>Credit Bureau</div>

        {documents?.credit_bureau ? (
          <div style={docCard}>
            <div>
              <div style={{ fontWeight: 900 }}>
                {documents.credit_bureau.original_name || "Credit Bureau PDF"}
              </div>
              <div style={docMeta}>
                Uploaded {formatDate(documents.credit_bureau.created_at)} •{" "}
                {formatBytes(documents.credit_bureau.size_bytes)}
              </div>
            </div>
            <span style={statusGood}>Present</span>
          </div>
        ) : (
          <div style={warningBox}>
            No credit bureau file found for this deal. Step 5 can’t go forward without it.
          </div>
        )}
      </section>

      <section style={card}>
        <div style={sectionTitle}>Stipulations & Uploads</div>
        <div style={helperText}>
          Upload the docs needed to fund the deal. Required items are flagged. Multiple uploads per
          category are allowed because real life enjoys being messy.
        </div>

        {loadingDocs ? <div style={infoBox}>Loading documents…</div> : null}

        <div style={{ display: "grid", gap: 12 }}>
          {STIP_CONFIG.map((stip) => {
            const files = documents?.[stip.key] ?? [];
            const isUploading = uploadingDocType === stip.key;

            return (
              <div
                key={stip.key}
                style={{
                  ...stipRow,
                  border:
                    dragDocType === stip.key
                      ? "1px solid rgba(70,205,255,0.45)"
                      : stipRow.border,
                  background:
                    dragDocType === stip.key
                      ? "rgba(70,205,255,0.08)"
                      : stipRow.background,
                }}
                onDragOver={(event) => onDragOverDoc(event, stip.key)}
                onDragLeave={onDragLeaveDoc}
                onDrop={(event) => onDropDoc(event, stip.key)}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 14 }}>{stip.label}</div>
                    {stip.required ? (
                      <span style={pillRequired}>Required</span>
                    ) : (
                      <span style={pillOptional}>Optional</span>
                    )}
                    {files.length > 0 ? (
                      <span style={pillGood}>
                        {files.length} file{files.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <div style={stipHelper}>{stip.helper}</div>
                  <div
                    style={{
                      ...stipHelper,
                      marginTop: 8,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border:
                        dragDocType === stip.key
                          ? "1px dashed rgba(70,205,255,0.65)"
                          : "1px dashed rgba(255,255,255,0.18)",
                      background:
                        dragDocType === stip.key
                          ? "rgba(70,205,255,0.12)"
                          : "rgba(255,255,255,0.03)",
                      color: "rgba(255,255,255,0.78)",
                      fontWeight: 700,
                    }}
                  >
                    Drag and drop files here, or use Upload.
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <input
                    ref={(el) => {
                      fileInputRefs.current[stip.key] = el;
                    }}
                    type="file"
                    hidden
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                    onChange={(e) => onUploadFile(stip.key, e.target.files?.[0] ?? null)}
                  />

                  <button
                    type="button"
                    onClick={() => openPicker(stip.key)}
                    disabled={isUploading}
                    style={{
                      ...btnSecondary,
                      minWidth: 120,
                      cursor: isUploading ? "not-allowed" : "pointer",
                      opacity: isUploading ? 0.65 : 1,
                    }}
                  >
                    {isUploading ? "Uploading..." : "Upload"}
                  </button>
                </div>

                {files.length > 0 ? (
                  <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
                    {files.map((doc) => (
                      <div key={doc.id} style={docCard}>
                        <div>
                          <div style={{ fontWeight: 800 }}>
                            {doc.original_name || "Uploaded file"}
                          </div>
                          <div style={docMeta}>
                            {formatDate(doc.created_at)} • {formatBytes(doc.size_bytes)} •{" "}
                            {doc.mime_type || "unknown type"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      fontSize: 13,
                      color: "rgba(255,255,255,0.58)",
                      fontWeight: 700,
                    }}
                  >
                    No files uploaded yet.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div style={gridTwo}>
        <section style={card}>
          <div style={sectionTitle}>Funding Notes</div>
          <div style={helperText}>
            Notes that travel with the deal handoff into funding.
          </div>
          <textarea
            value={submitNotes}
            onChange={(e) => setSubmitNotes(e.target.value)}
            placeholder="Add stipulations, conditions, callback notes, or funding comments..."
            style={textarea}
          />
        </section>

        <section style={card}>
          <div style={sectionTitle}>Internal Notes</div>
          <div style={helperText}>
            Handoff notes to finance, sales, recon, or whoever gets the pleasure next.
          </div>
          <textarea
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            placeholder="Add internal deal notes..."
            style={textarea}
          />
        </section>
      </div>

      <section style={card}>
        <div style={sectionTitle}>Submit Status</div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={statusRow}>
            <span style={statusLabel}>Ready for submit</span>
            <span style={canSubmit ? statusGood : statusBad}>
              {canSubmit ? "Yes" : "No"}
            </span>
          </div>

          <div style={statusRow}>
            <span style={statusLabel}>Submitted</span>
            <span style={submitted ? statusGood : statusBad}>
              {submitted ? "Yes" : "No"}
            </span>
          </div>

          <div style={statusRow}>
            <span style={statusLabel}>Blocking items</span>
            <span style={statusText}>
              {blockingItems.length > 0 ? blockingItems.join(" ") : "No blockers found."}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function ChecklistRow({
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
        border: `1px solid ${ok ? "rgba(16,185,129,0.2)" : "rgba(248,113,113,0.2)"}`,
        borderRadius: 12,
        background: ok ? "rgba(16,185,129,0.08)" : "rgba(127,29,29,0.18)",
      }}
    >
      <div
        style={{
          fontWeight: 900,
          color: ok ? "#34d399" : "#f87171",
          fontSize: 16,
          lineHeight: "18px",
        }}
      >
        {ok ? "✓" : "✕"}
      </div>

      <div>
        <div style={{ fontWeight: 900, fontSize: 14 }}>{label}</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.58)", marginTop: 2 }}>{detail}</div>
      </div>
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
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: 16,
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015))",
  boxShadow: "0 16px 36px rgba(0,0,0,0.2)",
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 16,
  marginBottom: 12,
  color: "#f5f7fa",
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
  color: "rgba(255,255,255,0.68)",
  marginBottom: 10,
  lineHeight: 1.45,
};

const stipHelper: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.68)",
  lineHeight: 1.45,
  marginTop: 4,
};

const textarea: React.CSSProperties = {
  width: "100%",
  minHeight: 120,
  resize: "vertical",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(10,18,30,0.45)",
  color: "#f5f7fa",
  padding: 12,
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid rgb(70,205,255)",
  background: "rgb(70,205,255)",
  color: "rgb(10,18,30)",
  fontWeight: 900,
};

const btnSecondary: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(10,18,30,0.45)",
  color: "rgba(255,255,255,0.92)",
  cursor: "pointer",
  fontWeight: 900,
};

const infoBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(10,18,30,0.35)",
  color: "rgba(255,255,255,0.85)",
  fontWeight: 700,
};

const warningBox: React.CSSProperties = {
  padding: 14,
  borderRadius: 12,
  border: "1px solid rgba(245,158,11,0.24)",
  background: "rgba(245,158,11,0.12)",
  color: "#fbbf24",
};

const errorBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(248,113,113,0.28)",
  background: "rgba(127,29,29,0.22)",
  color: "#fca5a5",
  fontWeight: 900,
};

const successBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(16,185,129,0.28)",
  background: "rgba(16,185,129,0.12)",
  color: "#34d399",
  fontWeight: 900,
};

const statusRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "180px 1fr",
  gap: 10,
  alignItems: "start",
};

const statusLabel: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 900,
  color: "rgba(255,255,255,0.62)",
};

const statusText: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
};

const statusGood: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 900,
  color: "#34d399",
};

const statusBad: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 900,
  color: "#f87171",
};

const stipRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: 12,
  alignItems: "start",
  padding: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  background: "rgba(10,18,30,0.28)",
};

const docCard: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  padding: 10,
  background: "rgba(10,18,30,0.38)",
};

const docMeta: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.58)",
  marginTop: 2,
};

const pillRequired: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  padding: "3px 8px",
  borderRadius: 999,
  background: "rgba(127,29,29,0.22)",
  color: "#fca5a5",
  border: "1px solid rgba(248,113,113,0.28)",
};

const pillOptional: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  padding: "3px 8px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.04)",
  color: "rgba(255,255,255,0.58)",
  border: "1px solid rgba(255,255,255,0.08)",
};

const pillGood: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  padding: "3px 8px",
  borderRadius: 999,
  background: "rgba(16,185,129,0.12)",
  color: "#34d399",
  border: "1px solid rgba(16,185,129,0.28)",
};
