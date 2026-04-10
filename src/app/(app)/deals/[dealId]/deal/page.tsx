"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { DealStep } from "@/lib/deals/canAccessStep";
import type { DealOverrideBlockerCode } from "@/lib/deals/dealOverrideFingerprint";
import { canRequestOverrideForBlockerState } from "@/lib/deals/dealOverrideWorkflow";
import {
  buildDealOverrideRequestLines,
  formatDealOverrideBlockerLabel,
} from "@/lib/deals/dealOverrideSummary";

type DealQuery = {
  vehicleId: string | null;
  option: string | null;
  cashDown: string | null;
  vsc: string | null;
  gap: string | null;
  termMonths: string | null;
  monthlyPayment: string | null;
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

type DealStructureResponse = {
  ok: boolean;
  deal_id: string;
  customerName: string | null;
  underwriting: {
    apr: number | null;
    decision?: string | null;
    max_amount_financed: number | null;
    max_ltv: number | null;
    max_pti: number | null;
    max_term_months: number | null;
    max_vehicle_price: number | null;
    min_cash_down: number | null;
    min_down_pct: number | null;
    tier: string | null;
  } | null;
  selection: Selection;
  structureInputs: {
    organization_id: string;
    deal_id: string;
    vehicle_id: string;
    option_label: "NONE" | "VSC" | "GAP" | "VSC+GAP";
    include_vsc: boolean;
    include_gap: boolean;
    term_months: number;
    cash_down: number | null;
    sale_price: number;
    tax_rate_main: number;
    tax_add_base: number;
    tax_add_rate: number;
    doc_fee: number;
    title_license: number;
    vsc_price: number;
    gap_price: number;
  };
  structure: {
    deal_id: string;
    selection: {
      vehicle_id: string;
      option_label: "NONE" | "VSC" | "GAP" | "VSC+GAP";
      include_vsc: boolean;
      include_gap: boolean;
    };
    vehicle: {
      id: string;
      stock_number: string | null;
      vin: string | null;
      year: number | null;
      make: string | null;
      model: string | null;
      odometer: number | null;
      status: string | null;
      date_in_stock: string | null;
      asking_price: number;
      jd_power_retail_book: number;
      vehicle_category: "car" | "suv" | "truck" | "van" | null;
      vehicle_age_years: number | null;
      vehicle_policy_max_term_months: number | null;
      vehicle_term_policy_note: string | null;
    };
    structure: {
      sale_price: number;
      cash_down_input: number;
      cash_down_effective: number;
      required_down: number;
      additional_down_needed: number;
      taxable_amount: number;
      sales_tax: number;
      doc_fee: number;
      title_license: number;
      fees_total: number;
      product_total: number;
      vsc_price: number;
      gap_price: number;
      amount_financed: number;
      apr: number;
      term_months: number;
      monthly_payment: number;
      ltv: number;
      fits_program: boolean;
      fail_reasons: string[];
      checks: {
        vehicle_price_ok: boolean;
        amount_financed_ok: boolean;
        ltv_ok: boolean;
        payment_ok: boolean;
      };
      additional_down_breakdown: {
        min_down: number;
        amount_financed: number;
        ltv: number;
        pti: number;
      };
    };
    assumptions: {
      tier: string | null;
      max_payment_cap: number;
      max_amount_financed: number;
      max_vehicle_price: number;
      max_ltv: number;
      trade_payoff: number;
      underwriting_max_term_months: number;
      vehicle_max_term_months: number;
      vehicle_base_term_months: number;
    };
  };
  overrides: {
    canApprove: boolean;
    canAcceptCounterOffers: boolean;
    currentFingerprint: string;
    currentInputFingerprint: string;
    rawBlockers: string[];
    effectiveBlockers: string[];
    blockerStates: Array<{
      blockerCode: DealOverrideBlockerCode;
      state: "blocked" | "pending" | "overridden" | "stale";
      staleReason: string | null;
    }>;
    requests: Array<{
      id: string;
      blocker_code: DealOverrideBlockerCode;
      status: string;
      requested_note: string | null;
      requested_at: string;
      reviewed_at: string | null;
      review_note: string | null;
      stale_reason: string | null;
      vehicle_id: string | null;
      cash_down_snapshot: number | null;
      amount_financed_snapshot: number | null;
      monthly_payment_snapshot: number | null;
      term_months_snapshot: number | null;
      ltv_snapshot: number | null;
      pti_snapshot: number | null;
      requesterName: string;
      reviewerName: string | null;
    }>;
    counterOffers: Array<{
      id: string;
      deal_override_request_id: string;
      version_number: number;
      counter_type: "improve_approval" | "reduce_risk" | "pricing_adjustment";
      review_note: string;
      reviewed_at: string;
      reviewerName: string | null;
      acceptedByName: string | null;
      accepted_at: string | null;
      status:
        | "active"
        | "accepted_counter"
        | "stale"
        | "superseded"
        | "rejected_acceptance";
      stale_reason: string | null;
      rejection_reason: string | null;
      inputs_json: DealStructureResponse["structureInputs"];
      outputs_snapshot_json: DealStructureResponse["structure"];
    }>;
    latestCounterOffer: {
      id: string;
      deal_override_request_id: string;
      version_number: number;
      counter_type: "improve_approval" | "reduce_risk" | "pricing_adjustment";
      review_note: string;
      reviewed_at: string;
      reviewerName: string | null;
      acceptedByName: string | null;
      accepted_at: string | null;
      status:
        | "active"
        | "accepted_counter"
        | "stale"
        | "superseded"
        | "rejected_acceptance";
      stale_reason: string | null;
      rejection_reason: string | null;
      inputs_json: DealStructureResponse["structureInputs"];
      outputs_snapshot_json: DealStructureResponse["structure"];
    } | null;
  };
};

type ApiErrorResponse = {
  error?: string;
  details?: string;
  reason?: string;
  redirectTo?: DealStep;
};

type CounterOfferEditorState = {
  cash_down: string;
  counter_type: "improve_approval" | "reduce_risk" | "pricing_adjustment";
  doc_fee: string;
  gap_price: string;
  include_gap: boolean;
  include_vsc: boolean;
  sale_price: string;
  tax_add_base: string;
  tax_add_rate: string;
  tax_rate_main: string;
  term_months: string;
  title_license: string;
  vsc_price: string;
};

function asString(value: string | string[] | undefined): string {
  if (!value) return "";
  return Array.isArray(value) ? value[0] : value;
}

function money(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function num(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString();
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

function fmtInput(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "" : String(value);
}

function buildCounterOfferEditorState(
  inputs: DealStructureResponse["structureInputs"]
): CounterOfferEditorState {
  return {
    cash_down: fmtInput(inputs.cash_down),
    counter_type: "improve_approval",
    doc_fee: fmtInput(inputs.doc_fee),
    gap_price: fmtInput(inputs.gap_price),
    include_gap: !!inputs.include_gap,
    include_vsc: !!inputs.include_vsc,
    sale_price: fmtInput(inputs.sale_price),
    tax_add_base: fmtInput(inputs.tax_add_base),
    tax_add_rate: fmtInput(inputs.tax_add_rate),
    tax_rate_main: fmtInput(inputs.tax_rate_main),
    term_months: fmtInput(inputs.term_months),
    title_license: fmtInput(inputs.title_license),
    vsc_price: fmtInput(inputs.vsc_price),
  };
}

function toCounterOfferPayload(
  editor: CounterOfferEditorState,
  baseInputs: DealStructureResponse["structureInputs"]
) {
  return {
    counter_type: editor.counter_type,
    counter_offer: {
      inputs: {
        ...baseInputs,
        cash_down: parseNumOrNull(editor.cash_down),
        doc_fee: Number(editor.doc_fee),
        gap_price: Number(editor.gap_price),
        include_gap: editor.include_gap,
        include_vsc: editor.include_vsc,
        option_label:
          editor.include_vsc && editor.include_gap
            ? "VSC+GAP"
            : editor.include_vsc
              ? "VSC"
              : editor.include_gap
                ? "GAP"
                : "NONE",
        sale_price: Number(editor.sale_price),
        tax_add_base: Number(editor.tax_add_base),
        tax_add_rate: Number(editor.tax_add_rate),
        tax_rate_main: Number(editor.tax_rate_main),
        term_months: Number(editor.term_months),
        title_license: Number(editor.title_license),
        vsc_price: Number(editor.vsc_price),
      },
    },
  };
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
      cashDown: sp.get("cashDown"),
      vsc: sp.get("vsc"),
      gap: sp.get("gap"),
      termMonths: sp.get("termMonths"),
      monthlyPayment: sp.get("monthlyPayment"),
    }),
    [sp]
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [structure, setStructure] = useState<DealStructureResponse["structure"] | null>(null);
  const [structureInputs, setStructureInputs] = useState<DealStructureResponse["structureInputs"] | null>(null);
  const [overrides, setOverrides] = useState<DealStructureResponse["overrides"] | null>(null);
  const [requestNotes, setRequestNotes] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [counterEditors, setCounterEditors] = useState<Record<string, CounterOfferEditorState>>({});
  const [counterPreviews, setCounterPreviews] = useState<Record<string, DealStructureResponse | null>>({});
  const [expandedCounterRequestId, setExpandedCounterRequestId] = useState<string | null>(null);
  const [workingKey, setWorkingKey] = useState<string | null>(null);

  const hasQuerySelection = useMemo(() => {
    return !!query.vehicleId && isValidLabel(query.option);
  }, [query.vehicleId, query.option]);

  async function loadSelection() {
    if (!dealId) return null;

    const r = await fetch(`/api/deals/${dealId}/vehicle-selection`, { cache: "no-store" });
    const j = await r.json();

    if (!r.ok) {
      if (j?.error === "STEP_BLOCKED" && j?.redirectTo) {
        router.replace(`/deals/${dealId}/${j.redirectTo}`);
        return null;
      }

      throw new Error(j?.details || j?.error || "Failed to load selection");
    }

    const nextSelection = j.selection ?? null;
    setSelection(nextSelection);
    return nextSelection;
  }

  async function loadStructure() {
    if (!dealId) return;

    const r = await fetch(`/api/deals/${dealId}/deal-structure`, { cache: "no-store" });
    const j: DealStructureResponse & ApiErrorResponse = await r.json();

    if (!r.ok) {
      if (j?.error === "STEP_BLOCKED" && j?.redirectTo) {
        router.replace(`/deals/${dealId}/${j.redirectTo}`);
        return;
      }

      throw new Error(j.details || j.error || "Failed to load deal structure");
    }

    setStructure(j.structure ?? null);
    setCustomerName(j.customerName ?? null);
    setSelection(j.selection ?? null);
    setStructureInputs(j.structureInputs ?? null);
    setOverrides(j.overrides ?? null);
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
        term_months: parseNumOrNull(query.termMonths),
        monthly_payment: parseNumOrNull(query.monthlyPayment),
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

      await loadStructure();

      router.replace(`/deals/${dealId}/deal`);
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Failed to save selection");
    } finally {
      setSaving(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!dealId) return;

    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);

      try {
        if (hasQuerySelection) {
          await persistFromQueryThenCleanUrl();
          return;
        }

        const loadedSelection = await loadSelection();

        if (!cancelled && loadedSelection) {
          await loadStructure();
        } else if (!cancelled) {
          setStructure(null);
          setOverrides(null);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setErr(error instanceof Error ? error.message : "Load failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, hasQuerySelection]);

  useEffect(() => {
    if (!structureInputs || !overrides?.requests?.length) {
      return;
    }

    setCounterEditors((current) => {
      const next = { ...current };
      for (const request of overrides.requests) {
        if (!next[request.id]) {
          next[request.id] = buildCounterOfferEditorState(structureInputs);
        }
      }
      return next;
    });
  }, [overrides?.requests, structureInputs]);

  const canNext =
    !!selection &&
    !!structure &&
    !loading &&
    !saving &&
    (overrides?.effectiveBlockers.length ?? 0) === 0;

  function onPrev() {
    router.push(`/deals/${dealId}/vehicle`);
  }

  function onNext() {
    setErr(null);

    if (!selection) {
      setErr("No vehicle selection saved. Go back to Step 3 and pick an option.");
      return;
    }

    if (!structure) {
      setErr("Deal structure is not ready yet.");
      return;
    }

    if ((overrides?.effectiveBlockers.length ?? 0) > 0) {
      setErr("Resolve or override all active program blockers before continuing.");
      return;
    }

    router.push(`/deals/${dealId}/submit`);
  }

  async function submitOverride(
    blockerCode: DealOverrideBlockerCode,
    action: "request" | "approve"
  ) {
    setErr(null);
    const note = (requestNotes[blockerCode] ?? "").trim();
    if (!note) {
      setErr("Override notes are required before submitting.");
      return null;
    }

    setWorkingKey(`${action}:${blockerCode}`);

    try {
      const r = await fetch(`/api/deals/${dealId}/override-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          blocker_code: blockerCode,
          requested_note: note,
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(
          j?.details ||
            j?.error ||
            (action === "approve"
              ? "Failed to approve override."
              : "Failed to request override.")
        );
      }

      setRequestNotes((current) => ({ ...current, [blockerCode]: "" }));
      await loadStructure();
      return typeof j?.request?.id === "string" ? j.request.id : null;
    } catch (error: unknown) {
      setErr(
        error instanceof Error
          ? error.message
          : action === "approve"
            ? "Failed to approve override."
            : "Failed to request override."
      );
      return null;
    } finally {
      setWorkingKey(null);
    }
  }

  async function startCounterOffer(
    blockerCode: DealOverrideBlockerCode,
    matchingRequest: DealStructureResponse["overrides"]["requests"][number] | null
  ) {
    setErr(null);

    if (matchingRequest?.status === "pending") {
      setExpandedCounterRequestId((current) =>
        current === matchingRequest.id ? null : matchingRequest.id
      );
      return;
    }

    const requestId = await submitOverride(blockerCode, "request");
    if (requestId) {
      setExpandedCounterRequestId(requestId);
    }
  }

  async function previewCounterOffer(requestId: string) {
    if (!structureInputs) {
      setErr("Deal structure inputs are not ready yet.");
      return;
    }

    const editor = counterEditors[requestId];
    if (!editor) {
      setErr("Counter offer inputs are not ready yet.");
      return;
    }

    setErr(null);
    setWorkingKey(`preview:${requestId}`);

    try {
      const r = await fetch(
        `/api/deals/${dealId}/override-requests/${requestId}/preview-counter`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toCounterOfferPayload(editor, structureInputs)),
        }
      );

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j?.details || j?.error || "Failed to preview counter offer.");
      }

      setCounterPreviews((current) => ({ ...current, [requestId]: j.preview ?? null }));
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Failed to preview counter offer.");
    } finally {
      setWorkingKey(null);
    }
  }

  async function reviewOverride(
    requestId: string,
    status: "approved" | "denied" | "countered"
  ) {
    setErr(null);
    setWorkingKey(`${status}:${requestId}`);

    try {
      const body: Record<string, unknown> = {
        status,
        review_note: reviewNotes[requestId] ?? "",
      };

      if (status === "countered") {
        if (!structureInputs) {
          throw new Error("Deal structure inputs are not ready yet.");
        }

        const editor = counterEditors[requestId];
        if (!editor) {
          throw new Error("Counter offer inputs are not ready yet.");
        }

        Object.assign(body, toCounterOfferPayload(editor, structureInputs));
      }

      const r = await fetch(
        `/api/deals/${dealId}/override-requests/${requestId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j?.details || j?.error || "Failed to review override.");
      }

      setReviewNotes((current) => ({ ...current, [requestId]: "" }));
      if (status === "countered") {
        setExpandedCounterRequestId(null);
        setCounterPreviews((current) => ({ ...current, [requestId]: null }));
      }
      await loadStructure();
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Failed to review override.");
    } finally {
      setWorkingKey(null);
    }
  }

  async function acceptCounterOffer(requestId: string) {
    setErr(null);
    setWorkingKey(`accept-counter:${requestId}`);

    try {
      const r = await fetch(
        `/api/deals/${dealId}/override-requests/${requestId}/accept-counter`,
        { method: "POST" }
      );
      const j: (DealStructureResponse & ApiErrorResponse) & {
        acceptedCounterOfferId?: string;
      } = await r.json().catch(() => ({}));

      if (!r.ok) {
        throw new Error(j?.details || j?.error || "Failed to accept counter offer.");
      }

      setSelection(j.selection ?? null);
      setStructure(j.structure ?? null);
      setStructureInputs(j.structureInputs ?? null);
      setCustomerName(j.customerName ?? null);
      setOverrides(j.overrides ?? null);
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Failed to accept counter offer.");
    } finally {
      setWorkingKey(null);
    }
  }

  if (!dealId) {
    return (
      <div style={{ padding: 16, color: "crimson" }}>
        Missing dealId in route params. (Check folder name: <code>deals/[dealId]/deal</code>)
      </div>
    );
  }

  const vehicle = structure?.vehicle;
  const dealMath = structure?.structure;
  const assumptions = structure?.assumptions;
  const blockerStates = overrides?.blockerStates ?? [];
  const requestHistory = overrides?.requests ?? [];
  const counterOfferHistory = overrides?.counterOffers ?? [];
  const latestCounterOffer = overrides?.latestCounterOffer ?? null;
  const hasEffectiveBlockers = (overrides?.effectiveBlockers.length ?? 0) > 0;
  const hasRawBlockers = (overrides?.rawBlockers.length ?? 0) > 0;

  return (
    <div style={{ display: "grid", gap: 12 }}>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
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
          title={!structure ? "Deal structure is not ready" : ""}
        >
          Next →
        </button>
      </div>

      {!selection ? (
        <div style={{ ...card, background: "#fafafa" }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Vehicle Selection</div>
          <div style={{ opacity: 0.85 }}>
            No selection saved yet. Go to <b>Step 3</b> and click a payment option.
          </div>
        </div>
      ) : null}

      {structure && vehicle && dealMath ? (
        <>
          {latestCounterOffer ? (
            <div style={{ ...card, borderColor: "#cbd5e1", background: "#f8fafc" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={sectionTitle}>Latest Counter Offer</div>
                  <div style={{ ...auditLine, fontWeight: 700 }}>
                    Version {latestCounterOffer.version_number} • {latestCounterOffer.counter_type.replace(/_/g, " ")} • {latestCounterOffer.status}
                  </div>
                  <div style={auditPreWrapLine}>{latestCounterOffer.review_note}</div>
                  {latestCounterOffer.stale_reason ? (
                    <div style={{ ...hintText, marginTop: 8 }}>{latestCounterOffer.stale_reason}</div>
                  ) : null}
                  {latestCounterOffer.rejection_reason ? (
                    <div style={{ ...hintText, marginTop: 8 }}>{latestCounterOffer.rejection_reason}</div>
                  ) : null}
                </div>
                {overrides?.canAcceptCounterOffers &&
                latestCounterOffer.status === "active" ? (
                  <button
                    type="button"
                    onClick={() => acceptCounterOffer(latestCounterOffer.deal_override_request_id)}
                    disabled={workingKey === `accept-counter:${latestCounterOffer.deal_override_request_id}`}
                    style={btnPrimary}
                  >
                    {workingKey === `accept-counter:${latestCounterOffer.deal_override_request_id}`
                      ? "Accepting..."
                      : "Accept Counter Offer"}
                  </button>
                ) : null}
              </div>
              <div style={compareGrid}>
                <div style={comparePanel}>
                  <div style={sectionSubtitle}>Current Structure</div>
                  <div style={compareLine}>Sale Price: {money(dealMath.sale_price)}</div>
                  <div style={compareLine}>Cash Down: {money(dealMath.cash_down_input)}</div>
                  <div style={compareLine}>Doc Fee: {money(dealMath.doc_fee)}</div>
                  <div style={compareLine}>Title / License: {money(dealMath.title_license)}</div>
                  <div style={compareLine}>Term: {dealMath.term_months} months</div>
                  <div style={compareLine}>Amount Financed: {money(dealMath.amount_financed)}</div>
                  <div style={compareLine}>Payment: {money(dealMath.monthly_payment)}</div>
                  <div style={compareLine}>LTV: {(Number(dealMath.ltv ?? 0) * 100).toFixed(1)}%</div>
                </div>
                <div style={comparePanel}>
                  <div style={sectionSubtitle}>Counter Offer</div>
                  <div style={compareLine}>Sale Price: {money(latestCounterOffer.outputs_snapshot_json.structure.sale_price)}</div>
                  <div style={compareLine}>Cash Down: {money(latestCounterOffer.outputs_snapshot_json.structure.cash_down_input)}</div>
                  <div style={compareLine}>Doc Fee: {money(latestCounterOffer.outputs_snapshot_json.structure.doc_fee)}</div>
                  <div style={compareLine}>Title / License: {money(latestCounterOffer.outputs_snapshot_json.structure.title_license)}</div>
                  <div style={compareLine}>Term: {latestCounterOffer.outputs_snapshot_json.structure.term_months} months</div>
                  <div style={compareLine}>Amount Financed: {money(latestCounterOffer.outputs_snapshot_json.structure.amount_financed)}</div>
                  <div style={compareLine}>Payment: {money(latestCounterOffer.outputs_snapshot_json.structure.monthly_payment)}</div>
                  <div style={compareLine}>LTV: {(Number(latestCounterOffer.outputs_snapshot_json.structure.ltv ?? 0) * 100).toFixed(1)}%</div>
                </div>
              </div>
            </div>
          ) : null}

          <div style={{ ...card, background: "#fafafa" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 900 }}>Selected Unit</div>
              <div>
                <b>
                  {vehicle.stock_number ?? "—"} • {vehicle.year ?? "—"} {vehicle.make ?? "—"}{" "}
                  {vehicle.model ?? "—"}
                </b>
              </div>
              <div style={{ opacity: 0.75 }}>
                {money(vehicle.asking_price)} •{" "}
                {vehicle.odometer != null ? `${num(vehicle.odometer)} mi` : "—"} •{" "}
                {(vehicle.vehicle_category ?? "car").toUpperCase()}
              </div>
              <div style={{ flex: 1 }} />
              <div
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontWeight: 900,
                  fontSize: 12,
                  background: hasEffectiveBlockers ? "#fff7ed" : "#ecfdf3",
                  color: hasEffectiveBlockers ? "#c2410c" : "#166534",
                  border: `1px solid ${hasEffectiveBlockers ? "#fed7aa" : "#bbf7d0"}`,
                }}
              >
                {hasEffectiveBlockers ? "Needs Attention" : "Ready to Continue"}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            }}
          >
            <div style={card}>
              <div style={sectionTitle}>Vehicle & Program</div>

              <div style={grid2}>
                <div style={k}>Stock #</div>
                <div style={v}>{vehicle.stock_number ?? "—"}</div>

                <div style={k}>Vehicle</div>
                <div style={v}>
                  {vehicle.year ?? "—"} {vehicle.make ?? "—"} {vehicle.model ?? "—"}
                </div>

                <div style={k}>Mileage</div>
                <div style={v}>{vehicle.odometer != null ? num(vehicle.odometer) : "—"}</div>

                <div style={k}>Sale Price</div>
                <div style={v}>{money(dealMath.sale_price)}</div>

                <div style={k}>JDP Retail Book</div>
                <div style={v}>{money(vehicle.jd_power_retail_book)}</div>

                <div style={k}>Tier</div>
                <div style={v}>{assumptions?.tier ?? "—"}</div>

                <div style={k}>Package</div>
                <div style={v}>
                  <b>{structure.selection.option_label}</b>{" "}
                  <span style={{ opacity: 0.75, fontSize: 13 }}>
                    ({structure.selection.include_vsc ? "VSC" : "No VSC"} •{" "}
                    {structure.selection.include_gap ? "GAP" : "No GAP"})
                  </span>
                </div>

                <div style={k}>APR</div>
                <div style={v}>{Number(dealMath.apr ?? 0).toFixed(2)}%</div>

                <div style={k}>Term</div>
                <div style={v}>{dealMath.term_months} months</div>

                <div style={k}>Monthly Payment</div>
                <div style={v}>
                  <b>{money(dealMath.monthly_payment)}</b>
                </div>

                <div style={k}>LTV</div>
                <div style={v}>
                  {dealMath.ltv ? `${(Number(dealMath.ltv) * 100).toFixed(1)}%` : "—"}
                </div>
              </div>
            </div>

            <div style={card}>
              <div style={sectionTitle}>Fees, Products & Cash</div>

              <div style={grid2}>
                <div style={k}>Cash Down Entered</div>
                <div style={v}>{money(dealMath.cash_down_input)}</div>

                <div style={k}>Cash Down Used</div>
                <div style={v}>{money(dealMath.cash_down_effective)}</div>

                <div style={k}>Required Down</div>
                <div style={v}>{money(dealMath.required_down)}</div>

                <div style={k}>Additional Down Needed</div>
                <div style={v}>
                  {dealMath.additional_down_needed > 0
                    ? money(dealMath.additional_down_needed)
                    : "—"}
                </div>

                <div style={k}>VSC Price</div>
                <div style={v}>{money(dealMath.vsc_price)}</div>

                <div style={k}>GAP Price</div>
                <div style={v}>{money(dealMath.gap_price)}</div>

                <div style={k}>Product Total</div>
                <div style={v}>{money(dealMath.product_total)}</div>

                <div style={k}>Taxable Amount</div>
                <div style={v}>{money(dealMath.taxable_amount)}</div>

                <div style={k}>Sales Tax</div>
                <div style={v}>{money(dealMath.sales_tax)}</div>

                <div style={k}>Doc Fee</div>
                <div style={v}>{money(dealMath.doc_fee)}</div>

                <div style={k}>Title / License</div>
                <div style={v}>{money(dealMath.title_license)}</div>

                <div style={k}>Fees Total</div>
                <div style={v}>{money(dealMath.fees_total)}</div>
              </div>
              {dealMath.cash_down_effective > dealMath.cash_down_input ? (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 13,
                    color: "#7c2d12",
                    fontWeight: 700,
                  }}
                >
                  Program minimum down increased cash used to the required threshold.
                </div>
              ) : null}
            </div>

            <div style={card}>
              <div style={sectionTitle}>Program Limits</div>

              <div style={grid2}>
                <div style={k}>Amount Financed</div>
                <div style={v}>
                  <b>{money(dealMath.amount_financed)}</b>
                </div>

                <div style={k}>Payment Cap</div>
                <div style={v}>{money(assumptions?.max_payment_cap)}</div>

                <div style={k}>Max Amount Financed</div>
                <div style={v}>
                  {assumptions?.max_amount_financed
                    ? money(assumptions.max_amount_financed)
                    : "—"}
                </div>

                <div style={k}>Max Vehicle Price</div>
                <div style={v}>
                  {assumptions?.max_vehicle_price
                    ? money(assumptions.max_vehicle_price)
                    : "—"}
                </div>

                <div style={k}>Max LTV</div>
                <div style={v}>
                  {assumptions?.max_ltv
                    ? `${(Number(assumptions.max_ltv) * 100).toFixed(1)}%`
                    : "—"}
                </div>

                <div style={k}>Trade Payoff</div>
                <div style={v}>{money(assumptions?.trade_payoff)}</div>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={sectionTitle}>Program Checks</div>

            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              }}
            >
              <CheckPill
                label="Vehicle Price"
                ok={dealMath.checks.vehicle_price_ok}
              />
              <CheckPill
                label="Amount Financed"
                ok={dealMath.checks.amount_financed_ok}
              />
              <CheckPill label="LTV" ok={dealMath.checks.ltv_ok} />
              <CheckPill label="Payment" ok={dealMath.checks.payment_ok} />
            </div>

            {hasRawBlockers || requestHistory.length ? (
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 900, color: "#b91c1c" }}>Blocking Issues</div>
                <div style={{ display: "grid", gap: 12 }}>
                  {blockerStates.map((blocker) => {
                    const matchingRequest =
                      requestHistory.find(
                        (request) => request.blocker_code === blocker.blockerCode
                      ) ?? null;

                    return (
                      <div key={blocker.blockerCode} style={overrideCard}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={failTag}>{formatDealOverrideBlockerLabel(blocker.blockerCode)}</span>
                              <span style={blockerStateTag(blocker.state)}>
                                {blocker.state === "overridden"
                                  ? "Overridden"
                                  : blocker.state === "pending"
                                    ? "Pending override"
                                    : blocker.state === "stale"
                                      ? "Stale"
                                      : "Blocked"}
                              </span>
                            </div>
                            {blocker.staleReason ? (
                              <div style={{ ...hintText, marginTop: 8 }}>{blocker.staleReason}</div>
                            ) : null}
                          </div>

                          {canRequestOverrideForBlockerState(blocker.state) ? (
                            <div style={{ minWidth: 260, display: "grid", gap: 8 }}>
                              <div style={requestPreviewCard}>
                                {buildDealOverrideRequestLines({
                                  blockerCode: blocker.blockerCode,
                                  customerName,
                                  snapshot: {
                                    assumptions: {
                                      max_amount_financed:
                                        assumptions?.max_amount_financed ?? null,
                                      max_ltv: assumptions?.max_ltv ?? null,
                                      max_payment_cap:
                                        assumptions?.max_payment_cap ?? null,
                                      max_vehicle_price:
                                        assumptions?.max_vehicle_price ?? null,
                                      tier: assumptions?.tier ?? null,
                                    },
                                    structure: {
                                      additional_down_breakdown:
                                        dealMath.additional_down_breakdown,
                                      additional_down_needed:
                                        dealMath.additional_down_needed,
                                      amount_financed: dealMath.amount_financed,
                                      cash_down_effective:
                                        dealMath.cash_down_effective,
                                      ltv: dealMath.ltv,
                                      monthly_payment: dealMath.monthly_payment,
                                      sale_price: dealMath.sale_price,
                                      term_months: dealMath.term_months,
                                    },
                                    vehicle: {
                                      make: vehicle.make,
                                      model: vehicle.model,
                                      odometer: vehicle.odometer,
                                      stock_number: vehicle.stock_number,
                                      year: vehicle.year,
                                    },
                                  },
                                }).map((line) => (
                                  <div key={line} style={requestPreviewLine}>
                                    {line}
                                  </div>
                                ))}
                              </div>
                              <textarea
                                value={requestNotes[blocker.blockerCode] ?? ""}
                                onChange={(event) =>
                                  setRequestNotes((current) => ({
                                    ...current,
                                    [blocker.blockerCode]: event.target.value,
                                  }))
                                }
                                placeholder="Required notes for the override audit trail..."
                                style={smallTextarea}
                              />
                              <div style={requestHelpText}>
                                The deal details above will be attached automatically. Notes are required.
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  submitOverride(
                                    blocker.blockerCode,
                                    overrides?.canApprove ? "approve" : "request"
                                  )
                                }
                                disabled={
                                  workingKey === `request:${blocker.blockerCode}` ||
                                  workingKey === `approve:${blocker.blockerCode}`
                                }
                                style={{
                                  ...btnSecondary,
                                  cursor:
                                    workingKey === `request:${blocker.blockerCode}` ||
                                    workingKey === `approve:${blocker.blockerCode}`
                                      ? "not-allowed"
                                      : "pointer",
                                  opacity:
                                    workingKey === `request:${blocker.blockerCode}` ||
                                    workingKey === `approve:${blocker.blockerCode}`
                                      ? 0.65
                                      : 1,
                                }}
                              >
                                {workingKey === `request:${blocker.blockerCode}`
                                  ? "Requesting..."
                                  : workingKey === `approve:${blocker.blockerCode}`
                                    ? "Approving..."
                                    : overrides?.canApprove
                                      ? blocker.state === "stale"
                                        ? "Approve New Override"
                                        : "Approve Override"
                                      : blocker.state === "stale"
                                        ? "Request New Override"
                                      : "Request Override"}
                              </button>
                              {overrides?.canApprove ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    startCounterOffer(blocker.blockerCode, matchingRequest)
                                  }
                                  disabled={
                                    workingKey === `request:${blocker.blockerCode}` ||
                                    workingKey === `approve:${blocker.blockerCode}`
                                  }
                                  style={btnSecondary}
                                >
                                  {matchingRequest?.status === "pending"
                                    ? expandedCounterRequestId === matchingRequest.id
                                      ? "Hide Counter Offer"
                                      : "Send Counter Offer"
                                    : "Create Counter Offer"}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        {overrides?.canApprove &&
                        matchingRequest &&
                        matchingRequest.status === "pending" ? (
                          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                            <textarea
                              value={reviewNotes[matchingRequest.id] ?? ""}
                              onChange={(event) =>
                                setReviewNotes((current) => ({
                                  ...current,
                                  [matchingRequest.id]: event.target.value,
                                }))
                              }
                              placeholder="Optional review note..."
                              style={smallTextarea}
                            />
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                onClick={() => reviewOverride(matchingRequest.id, "approved")}
                                disabled={workingKey === `approved:${matchingRequest.id}`}
                                style={btnPrimary}
                              >
                                {workingKey === `approved:${matchingRequest.id}`
                                  ? "Approving..."
                                  : "Approve Override"}
                              </button>
                              <button
                                type="button"
                                onClick={() => reviewOverride(matchingRequest.id, "denied")}
                                disabled={workingKey === `denied:${matchingRequest.id}`}
                                style={btnSecondary}
                              >
                                {workingKey === `denied:${matchingRequest.id}`
                                  ? "Declining..."
                                  : "Decline Override"}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedCounterRequestId((current) =>
                                    current === matchingRequest.id ? null : matchingRequest.id
                                  )
                                }
                                style={btnSecondary}
                              >
                                {expandedCounterRequestId === matchingRequest.id
                                  ? "Hide Counter Offer"
                                  : "Send Counter Offer"}
                              </button>
                            </div>
                            {expandedCounterRequestId === matchingRequest.id &&
                            structureInputs ? (
                              <div style={counterEditorCard}>
                                <div style={compareGrid}>
                                  <div style={comparePanel}>
                                    <div style={sectionSubtitle}>Current Structure</div>
                                    <div style={compareLine}>Sale Price: {money(dealMath.sale_price)}</div>
                                    <div style={compareLine}>Cash Down: {money(dealMath.cash_down_input)}</div>
                                    <div style={compareLine}>Sales Tax: {money(dealMath.sales_tax)}</div>
                                    <div style={compareLine}>Doc Fee: {money(dealMath.doc_fee)}</div>
                                    <div style={compareLine}>Title / License: {money(dealMath.title_license)}</div>
                                    <div style={compareLine}>VSC Price: {money(dealMath.vsc_price)}</div>
                                    <div style={compareLine}>GAP Price: {money(dealMath.gap_price)}</div>
                                    <div style={compareLine}>Term: {dealMath.term_months} months</div>
                                    <div style={compareLine}>Amount Financed: {money(dealMath.amount_financed)}</div>
                                    <div style={compareLine}>Payment: {money(dealMath.monthly_payment)}</div>
                                    <div style={compareLine}>Additional Down: {money(dealMath.additional_down_needed)}</div>
                                  </div>
                                  <div style={comparePanel}>
                                    <div style={sectionSubtitle}>Counter Offer</div>
                                    <div style={editorGrid}>
                                      <label style={editorLabel}>
                                        <span>Sale Price</span>
                                        <input
                                          value={counterEditors[matchingRequest.id]?.sale_price ?? ""}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                sale_price: event.target.value,
                                              },
                                            }))
                                          }
                                          style={editorInput}
                                        />
                                      </label>
                                      <label style={editorLabel}>
                                        <span>Tax Rate</span>
                                        <input
                                          value={counterEditors[matchingRequest.id]?.tax_rate_main ?? ""}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                tax_rate_main: event.target.value,
                                              },
                                            }))
                                          }
                                          style={editorInput}
                                        />
                                      </label>
                                      <label style={editorLabel}>
                                        <span>Tax Add Base</span>
                                        <input
                                          value={counterEditors[matchingRequest.id]?.tax_add_base ?? ""}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                tax_add_base: event.target.value,
                                              },
                                            }))
                                          }
                                          style={editorInput}
                                        />
                                      </label>
                                      <label style={editorLabel}>
                                        <span>Tax Add Rate</span>
                                        <input
                                          value={counterEditors[matchingRequest.id]?.tax_add_rate ?? ""}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                tax_add_rate: event.target.value,
                                              },
                                            }))
                                          }
                                          style={editorInput}
                                        />
                                      </label>
                                      <label style={editorLabel}>
                                        <span>Doc Fee</span>
                                        <input
                                          value={counterEditors[matchingRequest.id]?.doc_fee ?? ""}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                doc_fee: event.target.value,
                                              },
                                            }))
                                          }
                                          style={editorInput}
                                        />
                                      </label>
                                      <label style={editorLabel}>
                                        <span>Title / License</span>
                                        <input
                                          value={counterEditors[matchingRequest.id]?.title_license ?? ""}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                title_license: event.target.value,
                                              },
                                            }))
                                          }
                                          style={editorInput}
                                        />
                                      </label>
                                      <label style={editorLabel}>
                                        <span>Cash Down</span>
                                        <input
                                          value={counterEditors[matchingRequest.id]?.cash_down ?? ""}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                cash_down: event.target.value,
                                              },
                                            }))
                                          }
                                          style={editorInput}
                                        />
                                      </label>
                                      <label style={editorLabel}>
                                        <span>Term</span>
                                        <input
                                          value={counterEditors[matchingRequest.id]?.term_months ?? ""}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                term_months: event.target.value,
                                              },
                                            }))
                                          }
                                          style={editorInput}
                                        />
                                      </label>
                                      <label style={editorLabel}>
                                        <span>VSC Price</span>
                                        <input
                                          value={counterEditors[matchingRequest.id]?.vsc_price ?? ""}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                vsc_price: event.target.value,
                                              },
                                            }))
                                          }
                                          style={editorInput}
                                        />
                                      </label>
                                      <label style={editorLabel}>
                                        <span>GAP Price</span>
                                        <input
                                          value={counterEditors[matchingRequest.id]?.gap_price ?? ""}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                gap_price: event.target.value,
                                              },
                                            }))
                                          }
                                          style={editorInput}
                                        />
                                      </label>
                                      <label style={editorCheckbox}>
                                        <input
                                          type="checkbox"
                                          checked={counterEditors[matchingRequest.id]?.include_vsc ?? false}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                include_vsc: event.target.checked,
                                              },
                                            }))
                                          }
                                        />
                                        <span>Include VSC</span>
                                      </label>
                                      <label style={editorCheckbox}>
                                        <input
                                          type="checkbox"
                                          checked={counterEditors[matchingRequest.id]?.include_gap ?? false}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                include_gap: event.target.checked,
                                              },
                                            }))
                                          }
                                        />
                                        <span>Include GAP</span>
                                      </label>
                                      <label style={editorLabel}>
                                        <span>Counter Type</span>
                                        <select
                                          value={counterEditors[matchingRequest.id]?.counter_type ?? "improve_approval"}
                                          onChange={(event) =>
                                            setCounterEditors((current) => ({
                                              ...current,
                                              [matchingRequest.id]: {
                                                ...(current[matchingRequest.id] ?? buildCounterOfferEditorState(structureInputs)),
                                                counter_type: event.target.value as CounterOfferEditorState["counter_type"],
                                              },
                                            }))
                                          }
                                          style={editorInput}
                                        >
                                          <option value="improve_approval">Improve Approval</option>
                                          <option value="reduce_risk">Reduce Risk</option>
                                          <option value="pricing_adjustment">Pricing Adjustment</option>
                                        </select>
                                      </label>
                                    </div>
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                                      <button
                                        type="button"
                                        onClick={() => previewCounterOffer(matchingRequest.id)}
                                        disabled={workingKey === `preview:${matchingRequest.id}`}
                                        style={btnSecondary}
                                      >
                                        {workingKey === `preview:${matchingRequest.id}` ? "Previewing..." : "Preview Counter Offer"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => reviewOverride(matchingRequest.id, "countered")}
                                        disabled={workingKey === `countered:${matchingRequest.id}`}
                                        style={btnPrimary}
                                      >
                                        {workingKey === `countered:${matchingRequest.id}` ? "Sending..." : "Send Counter Offer"}
                                      </button>
                                    </div>
                                    {counterPreviews[matchingRequest.id] ? (
                                      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                                        <div style={sectionSubtitle}>Preview</div>
                                        <div style={compareLine}>Amount Financed: {money(counterPreviews[matchingRequest.id]?.structure.structure.amount_financed)}</div>
                                        <div style={compareLine}>Payment: {money(counterPreviews[matchingRequest.id]?.structure.structure.monthly_payment)}</div>
                                        <div style={compareLine}>LTV: {(Number(counterPreviews[matchingRequest.id]?.structure.structure.ltv ?? 0) * 100).toFixed(1)}%</div>
                                        <div style={compareLine}>Additional Down: {money(counterPreviews[matchingRequest.id]?.structure.structure.additional_down_needed)}</div>
                                        <div style={compareLine}>
                                          Fail Reasons: {counterPreviews[matchingRequest.id]?.structure.structure.fail_reasons.join(", ") || "None"}
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                  {dealMath.additional_down_breakdown.min_down > 0 ? (
                    <div style={hintText}>
                      Minimum down shortfall: {money(dealMath.additional_down_breakdown.min_down)}
                    </div>
                  ) : null}
                  {dealMath.additional_down_breakdown.amount_financed > 0 ? (
                    <div style={hintText}>
                      Over max amount financed by{" "}
                      {money(dealMath.additional_down_breakdown.amount_financed)}
                    </div>
                  ) : null}
                  {dealMath.additional_down_breakdown.ltv > 0 ? (
                    <div style={hintText}>
                      Over LTV by {money(dealMath.additional_down_breakdown.ltv)}
                    </div>
                  ) : null}
                  {dealMath.additional_down_breakdown.pti > 0 ? (
                    <div style={hintText}>
                      Over payment cap by {money(dealMath.additional_down_breakdown.pti)}
                    </div>
                  ) : null}
                </div>

                {counterOfferHistory.length ? (
                  <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                    <div style={sectionSubtitle}>Counter Offer History</div>
                    {counterOfferHistory.map((offer) => (
                      <div key={offer.id} style={auditCard}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={blockerStateTag(offer.status === "active" ? "pending" : offer.status === "stale" ? "stale" : "blocked")}>
                            {offer.status}
                          </span>
                          <span style={auditLine}>Version {offer.version_number}</span>
                          <span style={auditLine}>{offer.counter_type.replace(/_/g, " ")}</span>
                        </div>
                        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                          <div style={auditLine}>Reviewed: {new Date(offer.reviewed_at).toLocaleString()}</div>
                          <div style={auditLine}>Reviewer: {offer.reviewerName || "Unknown reviewer"}</div>
                          <div style={auditPreWrapLine}>Review note: {offer.review_note}</div>
                          <div style={auditLine}>
                            Proposed structure: sale {money(offer.outputs_snapshot_json.structure.sale_price)}, financed {money(offer.outputs_snapshot_json.structure.amount_financed)}, payment {money(offer.outputs_snapshot_json.structure.monthly_payment)}, term {offer.outputs_snapshot_json.structure.term_months} months
                          </div>
                          {offer.accepted_at ? (
                            <div style={auditLine}>
                              Accepted: {new Date(offer.accepted_at).toLocaleString()} by {offer.acceptedByName || "Unknown user"}
                            </div>
                          ) : null}
                          {offer.stale_reason ? <div style={auditLine}>Stale reason: {offer.stale_reason}</div> : null}
                          {offer.rejection_reason ? <div style={auditLine}>Rejection reason: {offer.rejection_reason}</div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {requestHistory.length ? (
                  <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                    <div style={sectionSubtitle}>Override History</div>
                    {requestHistory.map((request) => (
                      <div key={request.id} style={auditCard}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={failTag}>{formatDealOverrideBlockerLabel(request.blocker_code)}</span>
                          <span style={blockerStateTag(
                            request.status === "approved"
                              ? "overridden"
                              : request.status === "pending"
                                ? "pending"
                                : request.status === "stale"
                                  ? "stale"
                                  : "blocked"
                          )}>
                            {request.status}
                          </span>
                        </div>
                        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                          <div style={auditLine}>Requester: {request.requesterName}</div>
                          <div style={auditLine}>Requested: {new Date(request.requested_at).toLocaleString()}</div>
                          <div style={auditPreWrapLine}>Requester note: {request.requested_note || "None"}</div>
                          <div style={auditLine}>
                            Structure: down {money(request.cash_down_snapshot)}, financed {money(request.amount_financed_snapshot)}, payment {money(request.monthly_payment_snapshot)}, term {request.term_months_snapshot ?? "n/a"}, LTV {request.ltv_snapshot != null ? `${(Number(request.ltv_snapshot) * 100).toFixed(2)}%` : "n/a"}
                          </div>
                          <div style={auditLine}>Vehicle: {request.vehicle_id || "n/a"}</div>
                          <div style={auditLine}>Reviewer: {request.reviewerName || "Not reviewed"}</div>
                          <div style={auditLine}>Reviewed: {request.reviewed_at ? new Date(request.reviewed_at).toLocaleString() : "Not reviewed"}</div>
                          <div style={auditPreWrapLine}>Review note: {request.review_note || "None"}</div>
                          {request.stale_reason ? (
                            <div style={auditLine}>Stale reason: {request.stale_reason}</div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CheckPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      style={{
        border: `1px solid ${ok ? "#bbf7d0" : "#fecaca"}`,
        background: ok ? "#f0fdf4" : "#fef2f2",
        color: ok ? "#166534" : "#b91c1c",
        borderRadius: 12,
        padding: "10px 12px",
        fontWeight: 900,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <span>{label}</span>
      <span>{ok ? "OK" : "Blocked"}</span>
    </div>
  );
}

function blockerStateTag(state: "blocked" | "pending" | "overridden" | "stale") {
  if (state === "overridden") {
    return {
      ...statusTagBase,
      background: "#ecfdf3",
      border: "1px solid #bbf7d0",
      color: "#166534",
    };
  }

  if (state === "pending") {
    return {
      ...statusTagBase,
      background: "#fff8e8",
      border: "1px solid #fde68a",
      color: "#92400e",
    };
  }

  if (state === "stale") {
    return {
      ...statusTagBase,
      background: "#fff7ed",
      border: "1px solid #fdba74",
      color: "#c2410c",
    };
  }

  return {
    ...statusTagBase,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
  };
}

const card: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  borderRadius: 14,
  padding: 14,
  background: "#fff",
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 900,
  marginBottom: 10,
};

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "180px 1fr",
  gap: 10,
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


const failTag: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#b91c1c",
  fontWeight: 900,
  fontSize: 12,
};

const hintText: React.CSSProperties = {
  fontSize: 13,
  color: "#7c2d12",
  fontWeight: 700,
};

const statusTagBase: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  fontWeight: 900,
  fontSize: 12,
};

const overrideCard: React.CSSProperties = {
  border: "1px solid #ececec",
  borderRadius: 12,
  padding: 12,
  background: "#fafafa",
};

const smallTextarea: React.CSSProperties = {
  width: "100%",
  minHeight: 72,
  resize: "vertical",
  borderRadius: 10,
  border: "1px solid #d8d8d8",
  padding: 10,
  fontSize: 13,
  fontFamily: "inherit",
};

const requestPreviewCard: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  background: "#fff",
  padding: 10,
  display: "grid",
  gap: 4,
};

const requestPreviewLine: React.CSSProperties = {
  fontSize: 12,
  color: "#334155",
  fontWeight: 700,
};

const requestHelpText: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
  fontWeight: 600,
};

const compareGrid: React.CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  marginTop: 12,
};

const comparePanel: React.CSSProperties = {
  border: "1px solid #dbe2ea",
  borderRadius: 12,
  background: "#fff",
  padding: 12,
  display: "grid",
  gap: 6,
};

const compareLine: React.CSSProperties = {
  fontSize: 13,
  color: "#334155",
  fontWeight: 700,
};

const counterEditorCard: React.CSSProperties = {
  border: "1px solid #dbe2ea",
  borderRadius: 12,
  background: "#f8fafc",
  padding: 12,
};

const editorGrid: React.CSSProperties = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
};

const editorLabel: React.CSSProperties = {
  display: "grid",
  gap: 4,
  fontSize: 12,
  fontWeight: 700,
  color: "#475569",
};

const editorCheckbox: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  fontWeight: 700,
  color: "#475569",
};

const editorInput: React.CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "inherit",
};

const auditCard: React.CSSProperties = {
  border: "1px solid #ececec",
  borderRadius: 12,
  padding: 12,
  background: "#fff",
};

const auditLine: React.CSSProperties = {
  fontSize: 13,
  color: "#444",
};

const auditPreWrapLine: React.CSSProperties = {
  ...auditLine,
  whiteSpace: "pre-wrap",
};

const sectionSubtitle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 14,
};
