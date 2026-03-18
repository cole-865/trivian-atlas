"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  calcW2Income,
  calcTenureYM,
  formatTenure,
  parseMoney,
  safeDate,
  type PayFrequency,
} from "@/lib/income/w2";

const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  borderRadius: 10,
  padding: 10,
  background: "#fff",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#666",
  marginBottom: 4,
};

const valueStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
};

type Role = "primary" | "co";
type IncomeType = "w2" | "self_employed" | "fixed" | "cash";
type SaveState = "idle" | "saving" | "saved" | "error";

type IncomeRow = {
  id: string;
  deal_person_id: string;
  income_type: IncomeType;
  applied_to_deal: boolean;

  monthly_gross_manual: number | null;
  monthly_gross_calculated: number | null;

  manual_notes?: string | null;

  hire_date?: string | null;
  pay_period_end?: string | null;

  pay_frequency?: PayFrequency | null;
  gross_per_pay?: number | null;
  gross_ytd?: number | null;

  ytd_start_date?: string | null;
  ytd_end_date?: string | null;

  calc_flags?: any;

  created_at?: string;
  updated_at?: string;
};

type W2Form = {
  hireDate: string;
  payPeriodEnd: string;
  payFrequency: PayFrequency;
  grossThisPeriod: string;
  ytdGross: string;
};

const defaultW2Form: W2Form = {
  hireDate: "",
  payPeriodEnd: "",
  payFrequency: "biweekly",
  grossThisPeriod: "",
  ytdGross: "",
};

function money(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function pickMonthly(r: IncomeRow) {
  const c = r.monthly_gross_calculated;
  const m = r.monthly_gross_manual;
  return typeof c === "number" && Number.isFinite(c)
    ? c
    : typeof m === "number" && Number.isFinite(m)
      ? m
      : 0;
}

function labelType(t: IncomeType) {
  if (t === "w2") return "W2";
  if (t === "self_employed") return "Self-Employed";
  if (t === "fixed") return "Fixed";
  return "Cash";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function tenureLabelFromDates(startISO?: string | null, endISO?: string | null) {
  const start = safeDate(startISO ?? null);
  const end = safeDate(endISO ?? null);
  if (!start || !end) return "—";
  return formatTenure(calcTenureYM(start, end));
}

function toNumOrNull(v: string) {
  const cleaned = (v ?? "").replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function rowEqual(a: IncomeRow, b: IncomeRow) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function w2FormEqual(a: W2Form, b: W2Form) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function applyResultLooksOk(j: any) {
  return (
    j?.ok === true ||
    typeof j?.totals?.max_payment === "number" ||
    typeof j?.totals?.gross_monthly_income === "number"
  );
}

export default function IncomeStepClient({
  dealId,
  initialHouseholdIncome,
}: {
  dealId: string;
  initialHouseholdIncome: boolean;
}) {
  const router = useRouter();

  const effectiveDealId =
    dealId ||
    (typeof window !== "undefined" ? window.location.pathname.split("/")[2] : "");

  const [activeRole, setActiveRole] = useState<Role>("primary");
  const [householdIncome, setHouseholdIncome] = useState(initialHouseholdIncome);
  const [savingHI, setSavingHI] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [incomes, setIncomes] = useState<Record<Role, IncomeRow[]>>({
    primary: [],
    co: [],
  });

  const [lastSavedIncomes, setLastSavedIncomes] = useState<Record<Role, IncomeRow[]>>({
    primary: [],
    co: [],
  });

  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);
  const [saveStateByRowId, setSaveStateByRowId] = useState<Record<string, SaveState>>({});

  const [applyResult, setApplyResult] = useState<any>(null);
  const [applying, setApplying] = useState(false);
  const [appliedOk, setAppliedOk] = useState(false);

  const [w2ByRowId, setW2ByRowId] = useState<Record<string, W2Form>>({});
  const [lastSavedW2ByRowId, setLastSavedW2ByRowId] = useState<Record<string, W2Form>>({});

  const autosaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const saveSequenceRef = useRef<Record<string, number>>({});
  const saveBadgeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const firstLoadDoneRef = useRef(false);
  const autoApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function getW2Form(rowId: string): W2Form {
    return w2ByRowId[rowId] ?? defaultW2Form;
  }

  function setW2Form(rowId: string, next: W2Form) {
    setW2ByRowId((prev) => ({ ...prev, [rowId]: next }));
    setSaveStateByRowId((prev) => ({ ...prev, [rowId]: "idle" }));
  }

  function seedW2FromRows(rows: IncomeRow[]) {
    setW2ByRowId((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (r.income_type !== "w2") continue;
        next[r.id] = {
          hireDate: r.hire_date ?? "",
          payPeriodEnd: r.pay_period_end ?? "",
          payFrequency: (r.pay_frequency ?? "biweekly") as PayFrequency,
          grossThisPeriod:
            typeof r.gross_per_pay === "number" && Number.isFinite(r.gross_per_pay)
              ? String(r.gross_per_pay)
              : "",
          ytdGross:
            typeof r.gross_ytd === "number" && Number.isFinite(r.gross_ytd)
              ? String(r.gross_ytd)
              : "",
        };
      }
      return next;
    });

    setLastSavedW2ByRowId((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (r.income_type !== "w2") continue;
        next[r.id] = {
          hireDate: r.hire_date ?? "",
          payPeriodEnd: r.pay_period_end ?? "",
          payFrequency: (r.pay_frequency ?? "biweekly") as PayFrequency,
          grossThisPeriod:
            typeof r.gross_per_pay === "number" && Number.isFinite(r.gross_per_pay)
              ? String(r.gross_per_pay)
              : "",
          ytdGross:
            typeof r.gross_ytd === "number" && Number.isFinite(r.gross_ytd)
              ? String(r.gross_ytd)
              : "",
        };
      }
      return next;
    });
  }

  async function loadRole(role: Role) {
    const r = await fetch(`/api/deals/${effectiveDealId}/income/${role}`, {
      cache: "no-store",
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.details || j?.error || "Failed to load incomes");
    return (j.incomes ?? []) as IncomeRow[];
  }

  async function loadAll() {
    setLoading(true);
    setErr(null);
    try {
      const [p, c] = await Promise.all([loadRole("primary"), loadRole("co")]);
      const normalizedP = p.map((r) => ({ ...r, applied_to_deal: true }));
      const normalizedC = c.map((r) => ({ ...r, applied_to_deal: true }));

      setIncomes({ primary: normalizedP, co: normalizedC });
      setLastSavedIncomes({ primary: normalizedP, co: normalizedC });
      seedW2FromRows([...normalizedP, ...normalizedC]);

      const nextStates: Record<string, SaveState> = {};
      [...normalizedP, ...normalizedC].forEach((r) => {
        nextStates[r.id] = "idle";
      });
      setSaveStateByRowId(nextStates);

      firstLoadDoneRef.current = true;
      setAppliedOk(false);
    } catch (e: any) {
      setErr(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!effectiveDealId) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveDealId]);

  useEffect(() => {
    return () => {
      Object.values(autosaveTimersRef.current).forEach((t) => t && clearTimeout(t));
      Object.values(saveBadgeTimersRef.current).forEach((t) => t && clearTimeout(t));
      if (autoApplyTimerRef.current) clearTimeout(autoApplyTimerRef.current);
    };
  }, []);

  async function applyIncome(opts?: { silent?: boolean }) {
    const silent = !!opts?.silent;

    setApplying(true);
    if (!silent) {
      setErr(null);
      setApplyResult(null);
    }

    try {
      const r = await fetch(`/api/deals/${effectiveDealId}/income/apply`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.details || j?.error || "Failed to update totals");

      setApplyResult(j);
      setAppliedOk(applyResultLooksOk(j));
    } catch (e: any) {
      setAppliedOk(false);
      if (!silent) {
        setErr(e?.message || "Failed to update totals");
      }
    } finally {
      setApplying(false);
    }
  }

  async function toggleHousehold(next: boolean) {
    setHouseholdIncome(next);
    setSavingHI(true);
    setErr(null);
    setAppliedOk(false);

    try {
      const r = await fetch(`/api/deals/${effectiveDealId}/household-income`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ household_income: next }),
      });
      const j = await r.json();
      if (!r.ok) {
        throw new Error(j?.details || j?.error || "Failed to update household income");
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to update household income");
      setHouseholdIncome(!next);
    } finally {
      setSavingHI(false);
    }
  }

  async function addIncome(role: Role, income_type: IncomeType) {
    setErr(null);
    setAppliedOk(false);

    try {
      const r = await fetch(`/api/deals/${effectiveDealId}/income/${role}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ income_type }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.details || j?.error || "Failed to add income");

      const created: IncomeRow = {
        ...j.income,
        applied_to_deal: true,
      };

      setIncomes((prev) => ({ ...prev, [role]: [...prev[role], created] }));
      setLastSavedIncomes((prev) => ({ ...prev, [role]: [...prev[role], created] }));
      setSaveStateByRowId((prev) => ({ ...prev, [created.id]: "idle" }));

      if (created.income_type === "w2") {
        const seeded = {
          hireDate: created.hire_date ?? "",
          payPeriodEnd: created.pay_period_end ?? "",
          payFrequency: (created.pay_frequency ?? "biweekly") as PayFrequency,
          grossThisPeriod:
            typeof created.gross_per_pay === "number" && Number.isFinite(created.gross_per_pay)
              ? String(created.gross_per_pay)
              : "",
          ytdGross:
            typeof created.gross_ytd === "number" && Number.isFinite(created.gross_ytd)
              ? String(created.gross_ytd)
              : "",
        };

        setW2ByRowId((prev) => ({ ...prev, [created.id]: seeded }));
        setLastSavedW2ByRowId((prev) => ({ ...prev, [created.id]: seeded }));
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to add income");
    }
  }

  function updateRow(role: Role, rowId: string, next: IncomeRow) {
    setIncomes((prev) => ({
      ...prev,
      [role]: prev[role].map((x) =>
        x.id === rowId ? { ...next, applied_to_deal: true } : x
      ),
    }));
    setSaveStateByRowId((prev) => ({ ...prev, [rowId]: "idle" }));
    setAppliedOk(false);
  }

  async function saveIncome(role: Role, row: IncomeRow, opts?: { silent?: boolean }) {
    const silent = !!opts?.silent;
    const normalizedRow = { ...row, applied_to_deal: true };

    const lastSavedRow = (lastSavedIncomes[role] ?? []).find((x) => x.id === row.id);
    const currentW2 = getW2Form(row.id);
    const lastSavedW2 = lastSavedW2ByRowId[row.id] ?? defaultW2Form;

    if (lastSavedRow && rowEqual(normalizedRow, lastSavedRow)) {
      if (row.income_type !== "w2" || w2FormEqual(currentW2, lastSavedW2)) {
        return;
      }
    }

    const seq = (saveSequenceRef.current[row.id] ?? 0) + 1;
    saveSequenceRef.current[row.id] = seq;

    setSavingRowId(row.id);
    setSaveStateByRowId((prev) => ({ ...prev, [row.id]: "saving" }));
    if (!silent) setErr(null);

    try {
      const r = await fetch(`/api/deals/${effectiveDealId}/income/${role}/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          income_type: normalizedRow.income_type,
          applied_to_deal: true,
          monthly_gross_manual: normalizedRow.monthly_gross_manual,
          monthly_gross_calculated: normalizedRow.monthly_gross_calculated,
          hire_date: normalizedRow.hire_date,
          pay_period_end: normalizedRow.pay_period_end,
          pay_frequency: normalizedRow.pay_frequency,
          gross_per_pay: normalizedRow.gross_per_pay,
          gross_ytd: normalizedRow.gross_ytd,
          ytd_start_date: normalizedRow.ytd_start_date,
          ytd_end_date: normalizedRow.ytd_end_date,
          manual_notes: normalizedRow.manual_notes,
          calc_flags: normalizedRow.calc_flags,
        }),
      });

      const j = await r.json();
      if (!r.ok) throw new Error(j?.details || j?.error || "Failed to save income");

      if (saveSequenceRef.current[row.id] !== seq) return;

      const savedRow: IncomeRow = {
        ...j.income,
        applied_to_deal: true,
      };

      setIncomes((prev) => ({
        ...prev,
        [role]: prev[role].map((x) => (x.id === row.id ? savedRow : x)),
      }));

      setLastSavedIncomes((prev) => ({
        ...prev,
        [role]: prev[role].map((x) => (x.id === row.id ? savedRow : x)),
      }));

      if (savedRow.income_type === "w2") {
        setLastSavedW2ByRowId((prev) => ({
          ...prev,
          [row.id]: currentW2,
        }));
      }

      setSaveStateByRowId((prev) => ({ ...prev, [row.id]: "saved" }));

      if (saveBadgeTimersRef.current[row.id]) {
        clearTimeout(saveBadgeTimersRef.current[row.id]!);
      }

      saveBadgeTimersRef.current[row.id] = setTimeout(() => {
        setSaveStateByRowId((prev) => ({
          ...prev,
          [row.id]: prev[row.id] === "saved" ? "idle" : prev[row.id],
        }));
      }, 1500);
    } catch (e: any) {
      if (saveSequenceRef.current[row.id] !== seq) return;

      setSaveStateByRowId((prev) => ({ ...prev, [row.id]: "error" }));
      if (!silent) setErr(e?.message || "Failed to save income");
    } finally {
      setSavingRowId((current) => (current === row.id ? null : current));
    }
  }

  async function deleteIncome(role: Role, id: string) {
    setDeletingRowId(id);
    setErr(null);
    setAppliedOk(false);

    try {
      const r = await fetch(`/api/deals/${effectiveDealId}/income/${role}/${id}`, {
        method: "DELETE",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.details || j?.error || "Failed to delete income");

      setIncomes((prev) => ({
        ...prev,
        [role]: prev[role].filter((x) => x.id !== id),
      }));

      setLastSavedIncomes((prev) => ({
        ...prev,
        [role]: prev[role].filter((x) => x.id !== id),
      }));

      setW2ByRowId((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });

      setLastSavedW2ByRowId((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });

      setSaveStateByRowId((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });

      if (autosaveTimersRef.current[id]) {
        clearTimeout(autosaveTimersRef.current[id]!);
        delete autosaveTimersRef.current[id];
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to delete income");
    } finally {
      setDeletingRowId(null);
    }
  }

  const totals = useMemo(() => {
    const primary = incomes.primary.reduce((s, r) => s + pickMonthly(r), 0);

    const co = householdIncome
      ? incomes.co.reduce((s, r) => s + pickMonthly(r), 0)
      : 0;

    return { primary, co, total: primary + co };
  }, [incomes, householdIncome]);

  const activeRows = incomes[activeRole] ?? [];

  const hasUnsavedIncomeChanges = useMemo(() => {
    const primaryDirty =
      JSON.stringify(incomes.primary) !== JSON.stringify(lastSavedIncomes.primary);
    const coDirty = JSON.stringify(incomes.co) !== JSON.stringify(lastSavedIncomes.co);
    const w2Dirty = JSON.stringify(w2ByRowId) !== JSON.stringify(lastSavedW2ByRowId);
    return primaryDirty || coDirty || w2Dirty;
  }, [incomes, lastSavedIncomes, w2ByRowId, lastSavedW2ByRowId]);

  useEffect(() => {
    if (!firstLoadDoneRef.current) return;

    for (const role of ["primary", "co"] as Role[]) {
      for (const row of incomes[role]) {
        const lastSavedRow = (lastSavedIncomes[role] ?? []).find((x) => x.id === row.id);
        const currentW2 = getW2Form(row.id);
        const lastSavedW2 = lastSavedW2ByRowId[row.id] ?? defaultW2Form;

        const normalizedRow = { ...row, applied_to_deal: true };
        const rowDirty = !lastSavedRow || !rowEqual(normalizedRow, lastSavedRow);
        const w2Dirty = row.income_type === "w2" && !w2FormEqual(currentW2, lastSavedW2);

        if (!rowDirty && !w2Dirty) continue;

        if (autosaveTimersRef.current[row.id]) {
          clearTimeout(autosaveTimersRef.current[row.id]!);
        }

        autosaveTimersRef.current[row.id] = setTimeout(() => {
          void saveIncome(role, normalizedRow, { silent: true });
        }, 900);
      }
    }
  }, [incomes, lastSavedIncomes, w2ByRowId, lastSavedW2ByRowId]);

  useEffect(() => {
    if (!firstLoadDoneRef.current || loading) return;
    if (hasUnsavedIncomeChanges || savingHI || deletingRowId || savingRowId) return;

    if (autoApplyTimerRef.current) {
      clearTimeout(autoApplyTimerRef.current);
    }

    autoApplyTimerRef.current = setTimeout(() => {
      void applyIncome({ silent: true });
    }, 500);

    return () => {
      if (autoApplyTimerRef.current) clearTimeout(autoApplyTimerRef.current);
    };
  }, [
    hasUnsavedIncomeChanges,
    householdIncome,
    incomes,
    savingHI,
    deletingRowId,
    savingRowId,
    loading,
  ]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedIncomeChanges) return;
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedIncomeChanges]);

  function onPrev() {
    router.push(`/deals/${effectiveDealId}/customer`);
  }

  function onNext() {
    if (!appliedOk) {
      setErr("Wait for income totals to finish updating before continuing.");
      return;
    }
    router.push(`/deals/${effectiveDealId}/vehicle`);
  }

  const nextDisabled =
    loading || applying || hasUnsavedIncomeChanges || savingHI || !appliedOk;

  const activeRoleSaving = activeRows.some((r) => saveStateByRowId[r.id] === "saving");

  const summary = applyResult?.totals ?? applyResult ?? {};

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="m-0 text-lg font-semibold">Step 2: Income</h2>
          <div className="text-xs text-muted-foreground">
            Add income sources and the system will save and update totals automatically.
          </div>
        </div>

        {loading ? (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
            Loading…
          </span>
        ) : activeRoleSaving || savingHI ? (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
            Saving…
          </span>
        ) : hasUnsavedIncomeChanges ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
            Unsaved changes
          </span>
        ) : applying ? (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
            Updating totals…
          </span>
        ) : appliedOk ? (
          <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
            Income ready
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
            Waiting on totals
          </span>
        )}

        {err ? <span className="text-sm text-red-600">{err}</span> : null}

        <div className="flex-1" />

        <button type="button" onClick={onPrev} className={btnSecondaryClass}>
          ← Previous
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          className={[
            "rounded-xl px-3 py-2 text-sm font-semibold text-white",
            nextDisabled ? "bg-gray-400 cursor-not-allowed" : "bg-black hover:opacity-90",
          ].join(" ")}
          title={
            hasUnsavedIncomeChanges
              ? "Wait for changes to save"
              : applying
                ? "Totals are updating"
                : !appliedOk
                  ? "Wait for totals to update"
                  : ""
          }
        >
          Next →
        </button>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <label className="flex flex-wrap items-center gap-3">
          <input
            type="checkbox"
            checked={householdIncome}
            onChange={(e) => toggleHousehold(e.target.checked)}
            disabled={savingHI}
            className="h-4 w-4"
          />
          <span className="font-semibold">Household Income?</span>
          <span className="text-sm text-muted-foreground">
            {householdIncome ? "Include Co-app income" : "Exclude Co-app income"}
          </span>
          {savingHI ? (
            <span className="text-xs text-muted-foreground">Saving…</span>
          ) : applying ? (
            <span className="text-xs text-muted-foreground">Updating totals…</span>
          ) : null}
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="rounded-full border bg-white px-3 py-2 text-sm shadow-sm">
          Driver Income: <b>{money(totals.primary)}</b>
        </div>
        <div className="rounded-full border bg-white px-3 py-2 text-sm shadow-sm">
          Co-app Income: <b>{money(totals.co)}</b>{" "}
          {!householdIncome ? <span className="text-muted-foreground">(ignored)</span> : null}
        </div>
        <div className="rounded-full border bg-white px-3 py-2 text-sm shadow-sm">
          Total Income: <b>{money(totals.total)}</b>
        </div>
      </div>

      {applyResult && (
        <div
          style={{
            border: "1px solid #e5e5e5",
            borderRadius: 12,
            padding: 16,
            marginTop: 12,
            background: "#fafafa",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 12 }}>
            Income Summary ✓ Totals updated
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div style={cardStyle}>
              <div style={labelStyle}>Driver Income</div>
              <div style={valueStyle}>{money(summary.primary_applied)}</div>
            </div>

            <div style={cardStyle}>
              <div style={labelStyle}>Co-Applicant</div>
              <div style={valueStyle}>{money(summary.co_applied)}</div>
            </div>

            <div style={cardStyle}>
              <div style={labelStyle}>Total Income</div>
              <div style={valueStyle}>{money(summary.gross_monthly_income)}</div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 12,
            }}
          >
            <div style={cardStyle}>
              <div style={labelStyle}>Max Payment</div>
              <div style={valueStyle}>{money(summary.max_payment)}</div>
            </div>

            <div style={cardStyle}>
              <div style={labelStyle}>PTI Limit</div>
              <div style={valueStyle}>
                {typeof summary.max_payment_pct === "number"
                  ? `${(summary.max_payment_pct * 100).toFixed(0)}%`
                  : "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setActiveRole("primary")}
          className={[
            "rounded-xl border px-3 py-2 text-sm font-semibold",
            activeRole === "primary"
              ? "bg-black text-white border-black"
              : "bg-white hover:bg-gray-50",
          ].join(" ")}
        >
          Driver
        </button>

        <button
          onClick={() => setActiveRole("co")}
          className={[
            "rounded-xl border px-3 py-2 text-sm font-semibold",
            activeRole === "co"
              ? "bg-black text-white border-black"
              : "bg-white hover:bg-gray-50",
          ].join(" ")}
        >
          Co-app
        </button>

        <div className="flex-1" />

        <select
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value as IncomeType;
            if (!v) return;
            void addIncome(activeRole, v);
            e.currentTarget.value = "";
          }}
          className="rounded-xl border px-3 py-2 text-sm font-semibold"
        >
          <option value="">+ Add Income Source…</option>
          <option value="w2">W2</option>
          <option value="self_employed">Self-Employed</option>
          <option value="fixed">Fixed</option>
          <option value="cash">Cash</option>
        </select>
      </div>

      <div className="grid gap-3">
        {activeRows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No income sources yet. Add one.</div>
        ) : null}

        {activeRows.map((row) => (
          <IncomeCard
            key={row.id}
            role={activeRole}
            row={row}
            rowSaveState={saveStateByRowId[row.id] ?? "idle"}
            saving={savingRowId === row.id}
            deleting={deletingRowId === row.id}
            w2Form={getW2Form(row.id)}
            onChangeW2={(next) => {
              setW2Form(row.id, next);
              setAppliedOk(false);
            }}
            onChange={(next) => updateRow(activeRole, row.id, next)}
            onSave={() => saveIncome(activeRole, row)}
            onDelete={() => deleteIncome(activeRole, row.id)}
          />
        ))}
      </div>
    </div>
  );
}

function IncomeCard({
  role,
  row,
  rowSaveState,
  saving,
  deleting,
  w2Form,
  onChangeW2,
  onChange,
  onSave,
  onDelete,
}: {
  role: Role;
  row: IncomeRow;
  rowSaveState: SaveState;
  saving: boolean;
  deleting: boolean;
  w2Form: W2Form;
  onChangeW2: (next: W2Form) => void;
  onChange: (next: IncomeRow) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const timeOnJob = useMemo(() => {
    if (!row.hire_date) return "—";
    if (row.income_type === "w2") {
      const end = w2Form.payPeriodEnd || row.pay_period_end || "";
      return tenureLabelFromDates(row.hire_date, end || null);
    }
    return tenureLabelFromDates(row.hire_date, todayISO());
  }, [row.hire_date, row.income_type, row.pay_period_end, w2Form.payPeriodEnd]);

  const hireDateObj = safeDate(w2Form.hireDate || row.hire_date || null);
  const payEndObj = safeDate(w2Form.payPeriodEnd || row.pay_period_end || null);
  const grossThis = parseMoney(w2Form.grossThisPeriod);
  const ytd = parseMoney(w2Form.ytdGross);

  const w2Calc = useMemo(() => {
    if (row.income_type !== "w2") return null;
    if (!hireDateObj || !payEndObj) return null;

    return calcW2Income({
      hireDate: hireDateObj,
      payPeriodEnd: payEndObj,
      payFrequency: w2Form.payFrequency,
      grossThisPeriod: grossThis,
      ytdGross: ytd > 0 ? ytd : undefined,
    });
  }, [row.income_type, hireDateObj, payEndObj, w2Form.payFrequency, grossThis, ytd]);

  const canUseCalculated = row.income_type === "w2" && !!w2Calc && grossThis > 0;

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-semibold">{labelType(row.income_type)}</div>
        <div className="text-xs text-muted-foreground">
          ({role === "primary" ? "Driver" : "Co-app"})
        </div>

        <div className="text-xs text-muted-foreground">
          Time on job: <b>{timeOnJob}</b>
        </div>

        {rowSaveState === "saving" ? (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
            Saving…
          </span>
        ) : rowSaveState === "saved" ? (
          <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
            Saved
          </span>
        ) : rowSaveState === "error" ? (
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
            Error
          </span>
        ) : null}

        <div className="flex-1" />

        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-xl border border-black bg-black px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-400 disabled:border-gray-400"
        >
          {saving ? "Saving…" : "Save"}
        </button>

        <button
          onClick={onDelete}
          disabled={deleting}
          className="rounded-xl border px-3 py-2 text-sm font-semibold text-red-600 hover:bg-gray-50 disabled:cursor-not-allowed"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1">
          <div className="text-xs text-muted-foreground">Income Type</div>
          <select
            value={row.income_type}
            onChange={(e) => onChange({ ...row, income_type: e.target.value as IncomeType })}
            className="rounded-xl border px-3 py-2 text-sm"
          >
            <option value="w2">W2</option>
            <option value="self_employed">Self-Employed</option>
            <option value="fixed">Fixed</option>
            <option value="cash">Cash</option>
          </select>
        </label>

        <label className="grid gap-1">
          <div className="text-xs text-muted-foreground">Start Date (hire/start)</div>
          <input
            type="date"
            value={row.hire_date ?? ""}
            onChange={(e) => onChange({ ...row, hire_date: e.target.value || null })}
            className="rounded-xl border px-3 py-2 text-sm"
          />
          <div className="text-xs text-muted-foreground">
            Used for time on job. Non-W2 uses today automatically.
          </div>
        </label>

        <label className="grid gap-1 md:col-span-2">
          <div className="text-xs text-muted-foreground">Monthly Gross (manual)</div>
          <input
            value={row.monthly_gross_manual ?? ""}
            onChange={(e) =>
              onChange({
                ...row,
                monthly_gross_manual: e.target.value === "" ? null : toNumOrNull(e.target.value),
              })
            }
            placeholder="1.00"
            className="rounded-xl border px-3 py-2 text-sm"
          />
          <div className="text-xs text-muted-foreground">
            {row.monthly_gross_calculated ? (
              <>
                Calculated present (preferred): <b>{money(row.monthly_gross_calculated)}</b>
              </>
            ) : (
              <>Calculated will be preferred when set.</>
            )}
          </div>
        </label>
      </div>

      {row.income_type === "w2" ? (
        <div className="mt-4 border-t pt-4">
          <div className="mb-3 font-semibold">W2 Calculator</div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <div className="text-xs text-muted-foreground">Hire Date</div>
              <input
                type="date"
                value={w2Form.hireDate}
                onChange={(e) => {
                  const v = e.target.value;
                  onChangeW2({ ...w2Form, hireDate: v });
                  onChange({ ...row, hire_date: v || null });
                }}
                className="rounded-xl border px-3 py-2 text-sm"
              />
            </label>

            <label className="grid gap-1">
              <div className="text-xs text-muted-foreground">Pay Period End</div>
              <input
                type="date"
                value={w2Form.payPeriodEnd}
                onChange={(e) => {
                  const v = e.target.value;
                  onChangeW2({ ...w2Form, payPeriodEnd: v });
                  onChange({ ...row, pay_period_end: v || null });
                }}
                className="rounded-xl border px-3 py-2 text-sm"
              />
            </label>

            <label className="grid gap-1">
              <div className="text-xs text-muted-foreground">Pay Frequency</div>
              <select
                value={w2Form.payFrequency}
                onChange={(e) => {
                  const v = e.target.value as PayFrequency;
                  onChangeW2({ ...w2Form, payFrequency: v });
                  onChange({ ...row, pay_frequency: v });
                }}
                className="rounded-xl border px-3 py-2 text-sm"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="semimonthly">Semi-monthly</option>
                <option value="monthly">Monthly</option>
                <option value="annually">Annually</option>
              </select>
            </label>

            <label className="grid gap-1">
              <div className="text-xs text-muted-foreground">Gross This Period</div>
              <input
                value={w2Form.grossThisPeriod}
                onChange={(e) => {
                  const v = e.target.value;
                  onChangeW2({ ...w2Form, grossThisPeriod: v });
                  onChange({ ...row, gross_per_pay: toNumOrNull(v) });
                }}
                placeholder="1.00"
                className="rounded-xl border px-3 py-2 text-sm"
              />
            </label>

            <label className="grid gap-1 md:col-span-2">
              <div className="text-xs text-muted-foreground">YTD Gross (optional)</div>
              <input
                value={w2Form.ytdGross}
                onChange={(e) => {
                  const v = e.target.value;
                  onChangeW2({ ...w2Form, ytdGross: v });
                  onChange({ ...row, gross_ytd: toNumOrNull(v) });
                }}
                placeholder="1.00"
                className="rounded-xl border px-3 py-2 text-sm"
              />
              <div className="text-xs text-muted-foreground">
                {w2Calc ? (
                  <>
                    Tenure: <b>{w2Calc.tenureLabel}</b> · YTD start: <b>{w2Calc.ytdStartISO}</b>
                  </>
                ) : (
                  <>Enter dates to calculate tenure + YTD start.</>
                )}
              </div>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="rounded-full border bg-gray-50 px-3 py-2 text-sm">
              Monthly (annualized): <b>{w2Calc ? money(w2Calc.monthlyFromPaycheck) : "—"}</b>
            </div>

            <div className="rounded-full border bg-gray-50 px-3 py-2 text-sm">
              Monthly (YTD avg):{" "}
              <b>{w2Calc && w2Calc.monthlyFromYtd > 0 ? money(w2Calc.monthlyFromYtd) : "—"}</b>
            </div>

            <div className="flex-1" />

            <button
              type="button"
              disabled={!canUseCalculated}
              onClick={() => {
                if (!w2Calc) return;

                const monthly = w2Calc.monthlyFromPaycheck;
                const ytdEnd = w2Form.payPeriodEnd || row.pay_period_end || undefined;

                onChange({
                  ...row,
                  monthly_gross_calculated: monthly,
                  ytd_start_date: w2Calc.ytdStartISO,
                  ytd_end_date: ytdEnd,
                  calc_flags: {
                    ...(row.calc_flags ?? {}),
                    method: "w2_v1",
                    has_ytd: ytd > 0,
                  },
                });
              }}
              className={[
                "rounded-xl border px-3 py-2 text-sm font-semibold text-white",
                canUseCalculated
                  ? "bg-black border-black hover:opacity-90"
                  : "bg-gray-400 border-gray-400 cursor-not-allowed",
              ].join(" ")}
            >
              Use Calculated
            </button>
          </div>

          {row.monthly_gross_calculated ? (
            <div className="mt-2 text-xs text-muted-foreground">
              Current calc value (preferred): <b>{money(row.monthly_gross_calculated)}</b>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const btnSecondaryClass =
  "rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50";