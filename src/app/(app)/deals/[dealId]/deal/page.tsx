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
      pti: number;
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
      max_pti: number;
      trade_payoff: number;
      underwriting_max_term_months: number;
      vehicle_max_term_months: number;
      vehicle_base_term_months: number;
    };
    ai_review: {
      summary: string;
      consistency_status: "consistent" | "review" | "possible_anomaly";
      deal_strategy_hint:
        | "retail_viable"
        | "near_approval"
        | "needs_structure_change"
        | "bhph_preferred"
        | "high_risk";
      review_source: "openai" | "deterministic_fallback";
      review_model: string | null;
      key_factors: string[];
      recommended_actions: Array<{
        type:
          | "increase_down_payment"
          | "adjust_vehicle"
          | "adjust_term"
          | "remove_products"
          | "add_products"
          | "bhph_candidate"
          | "lender_redirect";
        description: string;
        impact: string;
        estimated_values?: {
          required_down?: number;
          estimated_payment?: number;
          term_months?: number;
          ltv?: number;
        } | null;
        confidence: "low" | "medium" | "high";
      }>;
      human_review_recommendations: string[];
      policy_gap_flags: string[];
      confidence_note: string;
      disclaimer: string;
      trigger_reasons: string[];
    } | null;
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
  sales_tax: string;
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

function titleCaseActionLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${(Number(value) * 100).toFixed(1)}%`;
}

function parseMoneyInput(value: string) {
  const normalized = value.replace(/[$,]/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateSalesTax(args: {
  includeVsc: boolean;
  salePrice: number;
  taxAddBase: number;
  taxAddRate: number;
  taxRateMain: number;
  vscPrice: number;
}) {
  const taxableAmount =
    Number(args.salePrice ?? 0) + (args.includeVsc ? Number(args.vscPrice ?? 0) : 0);
  const salesTax =
    taxableAmount * Number(args.taxRateMain ?? 0) +
    Math.min(taxableAmount, Number(args.taxAddBase ?? 0)) *
      Number(args.taxAddRate ?? 0);

  return Number(salesTax.toFixed(2));
}

function calculateCounterSalesTax(
  editor: CounterOfferEditorState,
  baseInputs: DealStructureResponse["structureInputs"]
) {
  return calculateSalesTax({
    includeVsc: editor.include_vsc,
    salePrice: parseMoneyInput(editor.sale_price),
    taxAddBase: Number(baseInputs.tax_add_base ?? 0),
    taxAddRate: Number(baseInputs.tax_add_rate ?? 0),
    taxRateMain: Number(baseInputs.tax_rate_main ?? 0),
    vscPrice: parseMoneyInput(editor.vsc_price),
  });
}

function withCalculatedSalesTax(
  editor: CounterOfferEditorState,
  baseInputs: DealStructureResponse["structureInputs"]
) {
  return {
    ...editor,
    sales_tax: fmtInput(calculateCounterSalesTax(editor, baseInputs)),
  };
}

function buildCounterOfferEditorState(
  inputs: DealStructureResponse["structureInputs"]
): CounterOfferEditorState {
  const salesTax = calculateSalesTax({
    includeVsc: inputs.include_vsc,
    salePrice: Number(inputs.sale_price ?? 0),
    taxAddBase: Number(inputs.tax_add_base ?? 0),
    taxAddRate: Number(inputs.tax_add_rate ?? 0),
    taxRateMain: Number(inputs.tax_rate_main ?? 0),
    vscPrice: Number(inputs.vsc_price ?? 0),
  });

  return {
    cash_down: fmtInput(inputs.cash_down),
    counter_type: "improve_approval",
    doc_fee: fmtInput(inputs.doc_fee),
    gap_price: fmtInput(inputs.gap_price),
    include_gap: !!inputs.include_gap,
    include_vsc: !!inputs.include_vsc,
    sale_price: fmtInput(inputs.sale_price),
    sales_tax: fmtInput(salesTax),
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
  const editorWithCalculatedTax = withCalculatedSalesTax(editor, baseInputs);
  const salesTax = parseMoneyInput(editorWithCalculatedTax.sales_tax);

  return {
    counter_type: editorWithCalculatedTax.counter_type,
    counter_offer: {
      inputs: {
        ...baseInputs,
        cash_down: parseNumOrNull(editorWithCalculatedTax.cash_down),
        doc_fee: Number(editorWithCalculatedTax.doc_fee),
        gap_price: Number(editorWithCalculatedTax.gap_price),
        include_gap: editorWithCalculatedTax.include_gap,
        include_vsc: editorWithCalculatedTax.include_vsc,
        option_label:
          editorWithCalculatedTax.include_vsc && editorWithCalculatedTax.include_gap
            ? "VSC+GAP"
            : editorWithCalculatedTax.include_vsc
              ? "VSC"
              : editorWithCalculatedTax.include_gap
                ? "GAP"
                : "NONE",
        sale_price: Number(editorWithCalculatedTax.sale_price),
        tax_add_base: salesTax,
        tax_add_rate: 1,
        tax_rate_main: 0,
        term_months: Number(editorWithCalculatedTax.term_months),
        title_license: Number(editorWithCalculatedTax.title_license),
        vsc_price: Number(editorWithCalculatedTax.vsc_price),
      },
    },
  };
}

function getBlockerDetailLine(args: {
  blockerCode: DealOverrideBlockerCode;
  assumptions: DealStructureResponse["structure"]["assumptions"];
  structure: DealStructureResponse["structure"]["structure"];
}) {
  const { blockerCode, assumptions, structure } = args;
  const breakdown = structure.additional_down_breakdown;

  if (blockerCode === "LTV") {
    return `LTV is ${formatPercent(structure.ltv)} vs ${formatPercent(assumptions.max_ltv)} max. Route to fix: ${money(breakdown.ltv)} additional down.`;
  }

  if (blockerCode === "PTI") {
    return `Payment is ${money(structure.monthly_payment)} vs ${money(assumptions.max_payment_cap)} cap. Route to fix: ${money(breakdown.pti)} additional down.`;
  }

  if (blockerCode === "AMOUNT_FINANCED") {
    return `Amount financed is ${money(structure.amount_financed)} vs ${money(assumptions.max_amount_financed)} max. Route to fix: ${money(breakdown.amount_financed)} additional down.`;
  }

  if (blockerCode === "VEHICLE_PRICE") {
    const overBy = Math.max(0, Number(structure.sale_price) - Number(assumptions.max_vehicle_price));
    return `Vehicle price is ${money(structure.sale_price)} vs ${money(assumptions.max_vehicle_price)} max. Over by ${money(overBy)}.`;
  }

  return null;
}

function getStructureIssueLine(args: {
  row: "sale_price" | "amount_financed" | "payment" | "ltv" | "additional_down";
  assumptions: DealStructureResponse["structure"]["assumptions"];
  structure: DealStructureResponse["structure"]["structure"];
}) {
  const { row, assumptions, structure } = args;

  if (
    row === "sale_price" &&
    assumptions.max_vehicle_price > 0 &&
    structure.sale_price > assumptions.max_vehicle_price
  ) {
    return `Over vehicle max by ${money(structure.sale_price - assumptions.max_vehicle_price)}.`;
  }

  if (
    row === "amount_financed" &&
    assumptions.max_amount_financed > 0 &&
    structure.amount_financed > assumptions.max_amount_financed
  ) {
    return `Amount financed must be <= ${money(assumptions.max_amount_financed)}.`;
  }

  if (
    row === "payment" &&
    assumptions.max_payment_cap > 0 &&
    structure.monthly_payment > assumptions.max_payment_cap
  ) {
    return `Payment must be <= ${money(assumptions.max_payment_cap)}.`;
  }

  if (
    row === "ltv" &&
    assumptions.max_ltv > 0 &&
    structure.ltv > assumptions.max_ltv
  ) {
    return `LTV must be <= ${formatPercent(assumptions.max_ltv)}.`;
  }

  if (row === "additional_down" && structure.additional_down_needed > 0) {
    return `Needs ${money(structure.additional_down_needed)} more down to fit.`;
  }

  return null;
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
  const [aiReview, setAiReview] = useState<DealStructureResponse["structure"]["ai_review"] | null>(null);
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
    setAiReview(j.structure?.ai_review ?? null);
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

  function updateCounterEditor(
    requestId: string,
    baseInputs: DealStructureResponse["structureInputs"],
    patch: Partial<CounterOfferEditorState>
  ) {
    setCounterEditors((current) => ({
      ...current,
      [requestId]: {
        ...(current[requestId] ?? buildCounterOfferEditorState(baseInputs)),
        ...patch,
      },
    }));
  }

  async function submitOverride(
    blockerCode: DealOverrideBlockerCode,
    action: "request" | "approve",
    options?: { allowEmptyNote?: boolean; counterOfferDraft?: boolean }
  ) {
    setErr(null);
    const note = (requestNotes[blockerCode] ?? "").trim();
    if (!note && !options?.allowEmptyNote) {
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
          counter_offer_draft: options?.counterOfferDraft ?? false,
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

    const requestId = await submitOverride(blockerCode, "request", {
      allowEmptyNote: true,
      counterOfferDraft: true,
    });
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
    const editorWithCalculatedTax = withCalculatedSalesTax(editor, structureInputs);

    setErr(null);
    setWorkingKey(`preview:${requestId}`);
    setCounterEditors((current) => ({
      ...current,
      [requestId]: editorWithCalculatedTax,
    }));

    try {
      const r = await fetch(
        `/api/deals/${dealId}/override-requests/${requestId}/preview-counter`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toCounterOfferPayload(editorWithCalculatedTax, structureInputs)),
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
    const reviewNote = (reviewNotes[requestId] ?? "").trim();

    if (status === "countered" && !reviewNote) {
      setErr("A note is required before sending a counter offer.");
      return;
    }

    if (status === "denied" && !reviewNote) {
      setErr("A note is required before declining an override.");
      return;
    }

    setWorkingKey(`${status}:${requestId}`);

    try {
      const body: Record<string, unknown> = {
        status,
        review_note: reviewNote,
      };

      if (status === "countered") {
        if (!structureInputs) {
          throw new Error("Deal structure inputs are not ready yet.");
        }

        const editor = counterEditors[requestId];
        if (!editor) {
          throw new Error("Counter offer inputs are not ready yet.");
        }
        const editorWithCalculatedTax = withCalculatedSalesTax(editor, structureInputs);
        setCounterEditors((current) => ({
          ...current,
          [requestId]: editorWithCalculatedTax,
        }));

        Object.assign(body, toCounterOfferPayload(editorWithCalculatedTax, structureInputs));
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
      <div style={{ padding: 16, color: "#fca5a5" }}>
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
  const latestHistoricalCounterOffer = counterOfferHistory[0] ?? null;
  const staleCounterOfferNotice =
    !latestCounterOffer &&
    latestHistoricalCounterOffer &&
    (latestHistoricalCounterOffer.status === "stale" ||
      latestHistoricalCounterOffer.status === "rejected_acceptance")
      ? latestHistoricalCounterOffer
      : null;
  const hasEffectiveBlockers = (overrides?.effectiveBlockers.length ?? 0) > 0;
  const hasRawBlockers = (overrides?.rawBlockers.length ?? 0) > 0;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {err ? (
        <div style={topDialog} role="alertdialog" aria-modal="false" aria-live="assertive">
          <div style={topDialogHeader}>
            <div style={{ fontWeight: 900 }}>Action Needed</div>
            <button type="button" onClick={() => setErr(null)} style={topDialogClose}>
              Dismiss
            </button>
          </div>
          <div style={topDialogMessage}>{err}</div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Step 4: Deal</h2>

        {loading ? <span style={{ opacity: 0.7 }}>Loading…</span> : null}
        {saving ? <span style={{ opacity: 0.7 }}>Saving…</span> : null}
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
            background: canNext ? "rgb(70,205,255)" : "rgba(148,163,184,0.45)",
            borderColor: canNext ? "rgb(70,205,255)" : "rgba(148,163,184,0.45)",
            color: canNext ? "rgb(10,18,30)" : "rgba(255,255,255,0.72)",
            cursor: canNext ? "pointer" : "not-allowed",
          }}
          title={!structure ? "Deal structure is not ready" : ""}
        >
          Next →
        </button>
      </div>

      {!selection ? (
        <div style={{ ...card, background: "rgba(10,18,30,0.3)" }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Vehicle Selection</div>
          <div style={{ opacity: 0.85 }}>
            No selection saved yet. Go to <b>Step 3</b> and click a payment option.
          </div>
        </div>
      ) : null}

      {structure && vehicle && dealMath ? (
        <>
          {staleCounterOfferNotice ? (
            <div
              style={{
                ...card,
                border: "1px solid rgba(251,146,60,0.28)",
                background: "rgba(124,45,18,0.18)",
              }}
            >
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={staleCounterOfferTag}>Counter Offer Removed</span>
                  <span style={{ ...auditLine, fontWeight: 700 }}>
                    Version {staleCounterOfferNotice.version_number} •{" "}
                    {staleCounterOfferNotice.counter_type.replace(/_/g, " ")}
                  </span>
                </div>
                <div style={bodyText}>
                  The previous counter offer is no longer valid for this deal. Review the current vehicle and structure,
                  then work the deal again from the normal process before sending another counter offer.
                </div>
                {staleCounterOfferNotice.stale_reason ? (
                  <div style={hintText}>{staleCounterOfferNotice.stale_reason}</div>
                ) : null}
                {staleCounterOfferNotice.rejection_reason ? (
                  <div style={hintText}>{staleCounterOfferNotice.rejection_reason}</div>
                ) : null}
              </div>
            </div>
          ) : null}

          {latestCounterOffer ? (
            <div style={{ ...card, border: "1px solid rgba(125,211,252,0.22)", background: "rgba(8,47,73,0.28)" }}>
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

          <div style={{ ...card, background: "rgba(10,18,30,0.3)" }}>
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
                  background: hasEffectiveBlockers ? "rgba(245,158,11,0.14)" : "rgba(16,185,129,0.14)",
                  color: hasEffectiveBlockers ? "#fbbf24" : "#34d399",
                  border: `1px solid ${hasEffectiveBlockers ? "rgba(245,158,11,0.28)" : "rgba(16,185,129,0.28)"}`,
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

                <div style={k}>PTI</div>
                <div style={v}>
                  {dealMath.pti ? `${(Number(dealMath.pti) * 100).toFixed(1)}%` : "-"}
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

                <div style={k}>Max PTI</div>
                <div style={v}>
                  {assumptions?.max_pti ? `${(Number(assumptions.max_pti) * 100).toFixed(1)}%` : "-"}
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
                    const blockerDetail = getBlockerDetailLine({
                      blockerCode: blocker.blockerCode,
                      assumptions: structure.assumptions,
                      structure: dealMath,
                    });

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
                            {blockerDetail ? (
                              <div style={{ ...blockerDetailText, marginTop: 8 }}>
                                {blockerDetail}
                              </div>
                            ) : null}
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
                            {expandedCounterRequestId === matchingRequest.id ? null : (
                              <textarea
                                value={reviewNotes[matchingRequest.id] ?? ""}
                                onChange={(event) =>
                                  setReviewNotes((current) => ({
                                    ...current,
                                    [matchingRequest.id]: event.target.value,
                                  }))
                                }
                                placeholder="Required for decline or counter offer..."
                                style={smallTextarea}
                              />
                            )}
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
                              (() => {
                                const requestId = matchingRequest.id;
                                const editor =
                                  counterEditors[requestId] ??
                                  buildCounterOfferEditorState(structureInputs);
                                const previewStructure =
                                  counterPreviews[requestId]?.structure.structure ?? null;
                                const displayStructure = previewStructure ?? dealMath;
                                const issueFor = (
                                  row:
                                    | "sale_price"
                                    | "amount_financed"
                                    | "payment"
                                    | "ltv"
                                    | "additional_down"
                                ) =>
                                  previewStructure
                                    ? getStructureIssueLine({
                                        row,
                                        assumptions: structure.assumptions,
                                        structure: previewStructure,
                                      })
                                    : null;

                                return (
                                  <div style={counterEditorCard}>
                                    <div style={counterWorksheetHeader}>
                                      <div style={sectionSubtitle}>Counter Structure</div>
                                      <div style={counterWorksheetHint}>
                                        Edit the current column, then calculate to validate the counter.
                                      </div>
                                    </div>
                                     <div style={counterWorksheet}>
                                      <div style={counterHeaderCell}>Field</div>
                                      <div style={counterHeaderCell}>Approved</div>
                                      <div style={counterHeaderCell}>Current</div>
                                      <div style={counterHeaderCell}>Issue</div>

                                      <div style={counterSectionLabel}>Tax / Fees</div>
                                      <CounterRow
                                        label="Sale Price"
                                        approved={money(dealMath.sale_price)}
                                        issue={issueFor("sale_price")}
                                      >
                                        <input
                                          value={editor.sale_price}
                                          onChange={(event) =>
                                            updateCounterEditor(requestId, structureInputs, {
                                              sale_price: event.target.value,
                                            })
                                          }
                                          style={editorInput}
                                        />
                                      </CounterRow>
                                      <CounterRow
                                        label="Sales Tax"
                                        approved={money(dealMath.sales_tax)}
                                      >
                                        <input
                                          value={editor.sales_tax}
                                          onChange={(event) =>
                                            updateCounterEditor(requestId, structureInputs, {
                                              sales_tax: event.target.value,
                                            })
                                          }
                                          style={editorInput}
                                        />
                                      </CounterRow>
                                      <CounterRow label="Doc Fee" approved={money(dealMath.doc_fee)}>
                                        <input
                                          value={editor.doc_fee}
                                          onChange={(event) =>
                                            updateCounterEditor(requestId, structureInputs, {
                                              doc_fee: event.target.value,
                                            })
                                          }
                                          style={editorInput}
                                        />
                                      </CounterRow>
                                      <CounterRow
                                        label="Title / License"
                                        approved={money(dealMath.title_license)}
                                      >
                                        <input
                                          value={editor.title_license}
                                          onChange={(event) =>
                                            updateCounterEditor(requestId, structureInputs, {
                                              title_license: event.target.value,
                                            })
                                          }
                                          style={editorInput}
                                        />
                                      </CounterRow>

                                      <div style={counterSectionLabel}>Down Pmt</div>
                                      <CounterRow
                                        label="Cash Down"
                                        approved={money(dealMath.cash_down_input)}
                                      >
                                        <input
                                          value={editor.cash_down}
                                          onChange={(event) =>
                                            updateCounterEditor(requestId, structureInputs, {
                                              cash_down: event.target.value,
                                            })
                                          }
                                          style={editorInput}
                                        />
                                      </CounterRow>

                                      <div style={counterSectionLabel}>Products</div>
                                      <CounterRow label="VSC" approved={money(dealMath.vsc_price)}>
                                        <div style={counterProductCell}>
                                          <label style={counterInlineCheckbox}>
                                            <input
                                              type="checkbox"
                                              checked={editor.include_vsc}
                                              onChange={(event) =>
                                                updateCounterEditor(requestId, structureInputs, {
                                                  include_vsc: event.target.checked,
                                                })
                                              }
                                            />
                                            Include
                                          </label>
                                          <input
                                            value={editor.vsc_price}
                                            onChange={(event) =>
                                              updateCounterEditor(requestId, structureInputs, {
                                                vsc_price: event.target.value,
                                              })
                                            }
                                            style={editorInput}
                                          />
                                        </div>
                                      </CounterRow>
                                      <CounterRow label="GAP" approved={money(dealMath.gap_price)}>
                                        <div style={counterProductCell}>
                                          <label style={counterInlineCheckbox}>
                                            <input
                                              type="checkbox"
                                              checked={editor.include_gap}
                                              onChange={(event) =>
                                                updateCounterEditor(requestId, structureInputs, {
                                                  include_gap: event.target.checked,
                                                })
                                              }
                                            />
                                            Include
                                          </label>
                                          <input
                                            value={editor.gap_price}
                                            onChange={(event) =>
                                              updateCounterEditor(requestId, structureInputs, {
                                                gap_price: event.target.value,
                                              })
                                            }
                                            style={editorInput}
                                          />
                                        </div>
                                      </CounterRow>

                                      <div style={counterSectionLabel}>Advance</div>
                                      <CounterRow
                                        label="Amount Financed"
                                        approved={money(dealMath.amount_financed)}
                                        current={money(displayStructure.amount_financed)}
                                        issue={issueFor("amount_financed")}
                                      />
                                      <CounterRow label="Term" approved={`${dealMath.term_months}`}>
                                        <input
                                          value={editor.term_months}
                                          onChange={(event) =>
                                            updateCounterEditor(requestId, structureInputs, {
                                              term_months: event.target.value,
                                            })
                                          }
                                          style={editorInput}
                                        />
                                      </CounterRow>
                                      <CounterRow
                                        label="Payment"
                                        approved={money(dealMath.monthly_payment)}
                                        current={money(displayStructure.monthly_payment)}
                                        issue={issueFor("payment")}
                                      />
                                      <CounterRow
                                        label="LTV"
                                        approved={formatPercent(dealMath.ltv)}
                                        current={formatPercent(displayStructure.ltv)}
                                        issue={issueFor("ltv")}
                                      />
                                       <CounterRow
                                         label="Additional Down"
                                         approved={money(dealMath.additional_down_needed)}
                                         current={money(displayStructure.additional_down_needed)}
                                         issue={issueFor("additional_down")}
                                       />
                                     </div>
                                    <textarea
                                      value={reviewNotes[requestId] ?? ""}
                                      onChange={(event) =>
                                        setReviewNotes((current) => ({
                                          ...current,
                                          [requestId]: event.target.value,
                                        }))
                                      }
                                      placeholder="Required for decline or counter offer..."
                                      style={smallTextarea}
                                    />
                                    <div style={counterWorksheetActions}>
                                      <button
                                        type="button"
                                        onClick={() => previewCounterOffer(requestId)}
                                        disabled={workingKey === `preview:${requestId}`}
                                        style={btnSecondary}
                                      >
                                        {workingKey === `preview:${requestId}` ? "Calculating..." : "Calculate"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => reviewOverride(requestId, "countered")}
                                        disabled={workingKey === `countered:${requestId}`}
                                        style={btnPrimary}
                                      >
                                        {workingKey === `countered:${requestId}` ? "Sending..." : "Send Counter Offer"}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })()
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

          {aiReview ? (
            <div style={card}>
              <div style={sectionTitle}>AI Review</div>

              <div style={{ display: "grid", gap: 16 }}>
                <div>
                  <div style={subsectionTitle}>Summary</div>
                  <div style={bodyText}>{aiReview.summary}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <span style={reviewSourceTag(aiReview.review_source)}>
                      {aiReview.review_source === "openai"
                        ? `OpenAI${aiReview.review_model ? ` · ${aiReview.review_model}` : ""}`
                        : "Deterministic Fallback"}
                    </span>
                    <span style={reviewTag(aiReview.consistency_status)}>
                      {aiReview.consistency_status.replace("_", " ")}
                    </span>
                    <span style={strategyTag}>
                      {aiReview.deal_strategy_hint.replace("_", " ")}
                    </span>
                  </div>
                </div>

                <div>
                  <div style={subsectionTitle}>Key Factors</div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {aiReview.key_factors.map((factor) => (
                      <div key={factor} style={reviewListItem}>
                        {factor}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={subsectionTitle}>Recommended Actions</div>
                  <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
                    {aiReview.recommended_actions.map((action, index) => (
                      <details
                        key={`${action.type}:${action.description}`}
                        open={index === 0}
                        style={{
                          ...reviewActionCard,
                          borderColor: index === 0 ? "#c2410c" : "#e5e7eb",
                        }}
                      >
                        <summary style={reviewActionSummary}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              {index === 0 ? <span style={bestNextStepTag}>Best Next Step</span> : null}
                              <span style={actionTypeTag}>
                                {titleCaseActionLabel(action.type)}
                              </span>
                              <span style={confidenceTag(action.confidence)}>
                                {action.confidence} confidence
                              </span>
                            </div>
                            <div style={{ fontWeight: 800, color: "#111827" }}>{action.description}</div>
                            <div style={bodyText}>{action.impact}</div>
                            {action.estimated_values ? (
                              <div style={actionMetricsRow}>
                                {action.estimated_values.required_down != null ? (
                                  <span style={metricPill}>
                                    Down Target {money(action.estimated_values.required_down)}
                                  </span>
                                ) : null}
                                {action.estimated_values.estimated_payment != null ? (
                                  <span style={metricPill}>
                                    Payment {money(action.estimated_values.estimated_payment)}
                                  </span>
                                ) : null}
                                {action.estimated_values.term_months != null ? (
                                  <span style={metricPill}>
                                    Term {action.estimated_values.term_months} mo
                                  </span>
                                ) : null}
                                {action.estimated_values.ltv != null ? (
                                  <span style={metricPill}>
                                    LTV {(Number(action.estimated_values.ltv) * 100).toFixed(1)}%
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </summary>
                      </details>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={subsectionTitle}>Human Review Notes</div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {aiReview.human_review_recommendations.map((note) => (
                      <div key={note} style={reviewListItem}>
                        {note}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={subsectionTitle}>Policy Flags</div>
                  {aiReview.policy_gap_flags.length ? (
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      {aiReview.policy_gap_flags.map((flag) => (
                        <div key={flag} style={policyFlagItem}>
                          {flag}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={hintText}>No policy gap flags on the current snapshot.</div>
                  )}
                </div>

                <div style={assistMetaCard}>
                  <div style={hintText}>{aiReview.confidence_note}</div>
                  <div style={{ ...hintText, marginTop: 6 }}>{aiReview.disclaimer}</div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function CheckPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      style={{
        border: `1px solid ${ok ? "rgba(16,185,129,0.28)" : "rgba(248,113,113,0.28)"}`,
        background: ok ? "rgba(16,185,129,0.12)" : "rgba(127,29,29,0.22)",
        color: ok ? "#34d399" : "#fca5a5",
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

function CounterRow({
  approved,
  children,
  current,
  issue,
  label,
}: {
  approved: React.ReactNode;
  children?: React.ReactNode;
  current?: React.ReactNode;
  issue?: string | null;
  label: string;
}) {
  return (
    <>
      <div style={counterRowLabel}>{label}</div>
      <div style={counterReadOnlyCell}>{approved}</div>
      <div style={counterCurrentCell}>{children ?? current ?? ""}</div>
      <div style={issue ? counterIssueText : counterIssueEmpty}>{issue ?? ""}</div>
    </>
  );
}

function blockerStateTag(state: "blocked" | "pending" | "overridden" | "stale") {
  if (state === "overridden") {
    return {
      ...statusTagBase,
      background: "rgba(16,185,129,0.14)",
      border: "1px solid rgba(16,185,129,0.28)",
      color: "#34d399",
    };
  }

  if (state === "pending") {
    return {
      ...statusTagBase,
      background: "rgba(245,158,11,0.14)",
      border: "1px solid rgba(245,158,11,0.28)",
      color: "#fbbf24",
    };
  }

  if (state === "stale") {
    return {
      ...statusTagBase,
      background: "rgba(249,115,22,0.16)",
      border: "1px solid rgba(249,115,22,0.28)",
      color: "#fb923c",
    };
  }

  return {
    ...statusTagBase,
    background: "rgba(127,29,29,0.22)",
    border: "1px solid rgba(248,113,113,0.28)",
    color: "#fca5a5",
  };
}

function reviewTag(
  status: "consistent" | "review" | "possible_anomaly"
): React.CSSProperties {
  if (status === "possible_anomaly") {
    return {
      ...statusTagBase,
      background: "rgba(127,29,29,0.22)",
      border: "1px solid rgba(248,113,113,0.28)",
      color: "#fca5a5",
      textTransform: "capitalize",
    };
  }

  if (status === "review") {
    return {
      ...statusTagBase,
      background: "rgba(245,158,11,0.14)",
      border: "1px solid rgba(245,158,11,0.28)",
      color: "#fbbf24",
      textTransform: "capitalize",
    };
  }

  return {
    ...statusTagBase,
    background: "rgba(16,185,129,0.14)",
    border: "1px solid rgba(16,185,129,0.28)",
    color: "#34d399",
    textTransform: "capitalize",
  };
}

function confidenceTag(
  confidence: "low" | "medium" | "high"
): React.CSSProperties {
  if (confidence === "high") {
    return {
      ...statusTagBase,
      background: "rgba(16,185,129,0.14)",
      border: "1px solid rgba(16,185,129,0.28)",
      color: "#34d399",
      textTransform: "capitalize",
    };
  }

  if (confidence === "medium") {
    return {
      ...statusTagBase,
      background: "rgba(245,158,11,0.14)",
      border: "1px solid rgba(245,158,11,0.28)",
      color: "#fbbf24",
      textTransform: "capitalize",
    };
  }

  return {
    ...statusTagBase,
    background: "rgba(148,163,184,0.14)",
    border: "1px solid rgba(148,163,184,0.28)",
    color: "#cbd5e1",
    textTransform: "capitalize",
  };
}

function reviewSourceTag(
  source: "openai" | "deterministic_fallback"
): React.CSSProperties {
  if (source === "openai") {
    return {
      ...statusTagBase,
      background: "rgba(14,165,233,0.14)",
      border: "1px solid rgba(14,165,233,0.28)",
      color: "#7dd3fc",
    };
  }

  return {
    ...statusTagBase,
    background: "rgba(148,163,184,0.14)",
    border: "1px solid rgba(148,163,184,0.28)",
    color: "#cbd5e1",
  };
}

const card: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: 14,
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015))",
  boxShadow: "0 16px 36px rgba(0,0,0,0.2)",
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 900,
  marginBottom: 10,
  color: "#f5f7fa",
};

const subsectionTitle: React.CSSProperties = {
  fontWeight: 800,
  color: "#f5f7fa",
};

const bodyText: React.CSSProperties = {
  color: "#d1d5db",
  fontSize: 14,
  lineHeight: 1.5,
};

const strategyTag: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 800,
  background: "rgba(59,130,246,0.14)",
  border: "1px solid rgba(59,130,246,0.28)",
  color: "#93c5fd",
  textTransform: "capitalize",
};

const reviewListItem: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "rgba(255,255,255,0.03)",
  color: "#d1d5db",
  fontSize: 14,
  lineHeight: 1.5,
};

const reviewActionCard: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 12,
  background: "rgba(255,255,255,0.03)",
};

const reviewActionSummary: React.CSSProperties = {
  listStyle: "none",
  cursor: "pointer",
};

const bestNextStepTag: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 800,
  background: "rgba(194,65,12,0.16)",
  border: "1px solid rgba(194,65,12,0.28)",
  color: "#fdba74",
};

const staleCounterOfferTag: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 800,
  background: "rgba(251,146,60,0.16)",
  border: "1px solid rgba(251,146,60,0.28)",
  color: "#fdba74",
};

const actionTypeTag: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 800,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#e5e7eb",
};

const actionMetricsRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginTop: 6,
};

const metricPill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 800,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#d1d5db",
};

const policyFlagItem: React.CSSProperties = {
  border: "1px solid rgba(248,113,113,0.28)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "rgba(127,29,29,0.22)",
  color: "#fecaca",
  fontSize: 14,
  lineHeight: 1.5,
};

const assistMetaCard: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 12,
  background: "rgba(255,255,255,0.02)",
};

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "180px 1fr",
  gap: 10,
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

const topDialog: React.CSSProperties = {
  position: "fixed",
  top: 16,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 1000,
  width: "min(720px, calc(100vw - 32px))",
  border: "1px solid rgba(248,113,113,0.35)",
  borderRadius: 8,
  background: "rgb(20,24,32)",
  boxShadow: "0 16px 40px rgba(15, 23, 42, 0.22)",
  padding: 14,
};

const topDialogHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 8,
};

const topDialogClose: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  background: "rgba(10,18,30,0.45)",
  cursor: "pointer",
  fontWeight: 900,
  padding: "6px 10px",
  color: "rgba(255,255,255,0.92)",
};

const topDialogMessage: React.CSSProperties = {
  color: "#fca5a5",
  fontWeight: 900,
  lineHeight: 1.4,
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
  background: "rgba(127,29,29,0.22)",
  border: "1px solid rgba(248,113,113,0.28)",
  color: "#fca5a5",
  fontWeight: 900,
  fontSize: 12,
};

const hintText: React.CSSProperties = {
  fontSize: 13,
  color: "#fdba74",
  fontWeight: 700,
};

const blockerDetailText: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.8)",
  fontWeight: 800,
};

const statusTagBase: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  fontWeight: 900,
  fontSize: 12,
};

const overrideCard: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 12,
  background: "rgba(10,18,30,0.28)",
};

const smallTextarea: React.CSSProperties = {
  width: "100%",
  minHeight: 72,
  resize: "vertical",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(10,18,30,0.45)",
  color: "#f5f7fa",
  padding: 10,
  fontSize: 13,
  fontFamily: "inherit",
};

const requestPreviewCard: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  background: "rgba(10,18,30,0.38)",
  padding: 10,
  display: "grid",
  gap: 4,
};

const requestPreviewLine: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.8)",
  fontWeight: 700,
};

const requestHelpText: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.62)",
  fontWeight: 600,
};

const compareGrid: React.CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  marginTop: 12,
};

const comparePanel: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  background: "rgba(10,18,30,0.38)",
  padding: 12,
  display: "grid",
  gap: 6,
  minWidth: 0,
};

const compareLine: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.82)",
  fontWeight: 700,
};

const counterEditorCard: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  background: "rgba(10,18,30,0.34)",
  padding: 12,
  overflowX: "auto",
};

const counterWorksheetHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  justifyContent: "space-between",
  flexWrap: "wrap",
  marginBottom: 10,
  minWidth: 720,
};

const counterWorksheetHint: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.62)",
  fontWeight: 700,
};

const counterWorksheet: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "170px 140px 170px minmax(260px, 1fr)",
  alignItems: "center",
  minWidth: 720,
  borderTop: "1px solid rgba(255,255,255,0.1)",
  borderLeft: "1px solid rgba(255,255,255,0.08)",
};

const counterHeaderCell: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  borderRight: "1px solid rgba(255,255,255,0.08)",
  borderBottom: "1px solid rgba(255,255,255,0.1)",
  padding: "7px 8px",
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(255,255,255,0.76)",
  textTransform: "uppercase",
};

const counterSectionLabel: React.CSSProperties = {
  gridColumn: "1 / -1",
  background: "rgba(70,205,255,0.12)",
  borderRight: "1px solid rgba(255,255,255,0.08)",
  borderBottom: "1px solid rgba(255,255,255,0.1)",
  color: "#7de2ff",
  fontSize: 12,
  fontWeight: 900,
  letterSpacing: 0,
  padding: "7px 8px",
  textTransform: "uppercase",
};

const counterRowLabel: React.CSSProperties = {
  borderRight: "1px solid rgba(255,255,255,0.08)",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(10,18,30,0.2)",
  padding: "7px 8px",
  fontSize: 13,
  color: "rgba(255,255,255,0.8)",
  fontWeight: 800,
  minHeight: 38,
  display: "flex",
  alignItems: "center",
};

const counterReadOnlyCell: React.CSSProperties = {
  ...counterRowLabel,
  justifyContent: "flex-end",
  color: "rgba(255,255,255,0.62)",
  fontVariantNumeric: "tabular-nums",
};

const counterCurrentCell: React.CSSProperties = {
  ...counterRowLabel,
  background: "rgba(255,255,255,0.03)",
  justifyContent: "flex-end",
  color: "#f5f7fa",
  fontVariantNumeric: "tabular-nums",
};

const counterIssueText: React.CSSProperties = {
  ...counterRowLabel,
  color: "#f87171",
  fontWeight: 900,
  justifyContent: "flex-start",
};

const counterIssueEmpty: React.CSSProperties = {
  ...counterIssueText,
  color: "rgba(255,255,255,0.52)",
};

const counterProductCell: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "72px 1fr",
  gap: 8,
  width: "100%",
  alignItems: "center",
};

const counterInlineCheckbox: React.CSSProperties = {
  display: "flex",
  gap: 5,
  alignItems: "center",
  fontSize: 12,
  color: "rgba(255,255,255,0.8)",
  fontWeight: 800,
};

const counterWorksheetActions: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  marginTop: 12,
};

const editorInput: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  padding: "6px 8px",
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  textAlign: "right",
};

const auditCard: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 12,
  background: "rgba(10,18,30,0.3)",
};

const auditLine: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.78)",
};

const auditPreWrapLine: React.CSSProperties = {
  ...auditLine,
  whiteSpace: "pre-wrap",
};

const sectionSubtitle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 14,
};
