"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  calcW2Income,
  calcTenureYM,
  formatTenure,
  parseMoney,
  safeDate,
  type PayFrequency,
} from "@/lib/income/w2";

type Role = "primary" | "co";
type IncomeType = "w2" | "self_employed" | "fixed" | "cash";

type IncomeRow = {
  id: string;
  deal_person_id: string;
  income_type: IncomeType;
  applied_to_deal: boolean;

  monthly_gross_manual: number | null;
  monthly_gross_calculated: number | null;

  manual_notes?: string | null;

  // Time-on-job + W2 persistence fields (exist in income_profiles)
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
    (typeof window !== "undefined"
      ? window.location.pathname.split("/")[2] // /deals/<dealId>/income
      : "");

  const [activeRole, setActiveRole] = useState<Role>("primary");
  const [householdIncome, setHouseholdIncome] = useState(initialHouseholdIncome);
  const [savingHI, setSavingHI] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [incomes, setIncomes] = useState<Record<Role, IncomeRow[]>>({
    primary: [],
    co: [],
  });

  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);

  const [applyResult, setApplyResult] = useState<any>(null);
  const [applying, setApplying] = useState(false);
  const [appliedOk, setAppliedOk] = useState(false); // gate Next

  // W2 inputs by income row id (supports multiple W2 jobs)
  const [w2ByRowId, setW2ByRowId] = useState<Record<string, W2Form>>({});

  function getW2Form(rowId: string): W2Form {
    return w2ByRowId[rowId] ?? defaultW2Form;
  }

  function setW2Form(rowId: string, next: W2Form) {
    setW2ByRowId((prev) => ({ ...prev, [rowId]: next }));
  }

  function seedW2FromRows(rows: IncomeRow[]) {
    setW2ByRowId((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (r.income_type !== "w2") continue;
        if (next[r.id]) continue;

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
      setIncomes({ primary: p, co: c });
      seedW2FromRows([...p, ...c]);
    } catch (e: any) {
      setErr(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!effectiveDealId) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveDealId]);

  async function toggleHousehold(next: boolean) {
    setHouseholdIncome(next);
    setSavingHI(true);
    setErr(null);
    try {
      const r = await fetch(`/api/deals/${effectiveDealId}/household-income`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ household_income: next }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.details || j?.error || "Failed to update household income");
      // household income affects totals, so force re-apply later
      setAppliedOk(false);
    } catch (e: any) {
      setErr(e?.message || "Failed to update household income");
      setHouseholdIncome(!next);
    } finally {
      setSavingHI(false);
    }
  }

  async function addIncome(role: Role, income_type: IncomeType) {
    setErr(null);
    try {
      const r = await fetch(`/api/deals/${effectiveDealId}/income/${role}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ income_type }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.details || j?.error || "Failed to add income");

      const created: IncomeRow = j.income;
      setIncomes((prev) => ({ ...prev, [role]: [...prev[role], created] }));
      setAppliedOk(false);

      if (created?.income_type === "w2") {
        setW2ByRowId((prev) => ({
          ...prev,
          [created.id]: {
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
          },
        }));
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to add income");
    }
  }

  async function saveIncome(role: Role, row: IncomeRow) {
    setSavingRowId(row.id);
    setErr(null);
    try {
      const r = await fetch(`/api/deals/${effectiveDealId}/income/${role}/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          income_type: row.income_type,
          applied_to_deal: row.applied_to_deal,

          monthly_gross_manual: row.monthly_gross_manual,
          monthly_gross_calculated: row.monthly_gross_calculated,

          hire_date: row.hire_date,
          pay_period_end: row.pay_period_end,

          pay_frequency: row.pay_frequency,
          gross_per_pay: row.gross_per_pay,
          gross_ytd: row.gross_ytd,

          ytd_start_date: row.ytd_start_date,
          ytd_end_date: row.ytd_end_date,

          manual_notes: row.manual_notes,
          calc_flags: row.calc_flags,
        }),
      });

      const j = await r.json();
      if (!r.ok) throw new Error(j?.details || j?.error || "Failed to save income");

      setIncomes((prev) => ({
        ...prev,
        [role]: prev[role].map((x) => (x.id === row.id ? j.income : x)),
      }));

      // edits invalidate "applied"
      setAppliedOk(false);
    } catch (e: any) {
      setErr(e?.message || "Failed to save income");
    } finally {
      setSavingRowId(null);
    }
  }

  async function deleteIncome(role: Role, id: string) {
    setDeletingRowId(id);
    setErr(null);
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

      setW2ByRowId((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });

      setAppliedOk(false);
    } catch (e: any) {
      setErr(e?.message || "Failed to delete income");
    } finally {
      setDeletingRowId(null);
    }
  }

  async function applyIncome() {
    setApplying(true);
    setErr(null);
    setApplyResult(null);
    try {
      const r = await fetch(`/api/deals/${effectiveDealId}/income/apply`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.details || j?.error || "Failed to apply income");

      setApplyResult(j);

      const ok =
        j?.ok === true ||
        typeof j?.totals?.max_payment === "number" ||
        typeof j?.totals?.gross_monthly_income === "number";

      setAppliedOk(!!ok);
    } catch (e: any) {
      setErr(e?.message || "Failed to apply income");
      setAppliedOk(false);
    } finally {
      setApplying(false);
    }
  }

  const totals = useMemo(() => {
    const primary = incomes.primary
      .filter((r) => r.applied_to_deal)
      .reduce((s, r) => s + pickMonthly(r), 0);

    const co = householdIncome
      ? incomes.co.filter((r) => r.applied_to_deal).reduce((s, r) => s + pickMonthly(r), 0)
      : 0;

    return { primary, co, total: primary + co };
  }, [incomes, householdIncome]);

  const activeRows = incomes[activeRole] ?? [];

  function onPrev() {
    router.push(`/deals/${effectiveDealId}/customer`);
  }

  function onNext() {
    if (!appliedOk) {
      setErr("Click 'Apply Income' before continuing.");
      return;
    }
    router.push(`/deals/${effectiveDealId}/vehicle`);
  }

  const nextDisabled = !appliedOk || loading || applying;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Header + Nav */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Step 2: Income</h2>

        {loading ? <span style={{ opacity: 0.7 }}>Loading…</span> : null}
        {err ? <span style={{ color: "crimson" }}>{err}</span> : null}

        <div style={{ flex: 1 }} />

        <button type="button" onClick={onPrev} style={btnSecondary}>
          ← Previous
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          style={{
            ...btnPrimary,
            background: nextDisabled ? "#999" : "#111",
            cursor: nextDisabled ? "not-allowed" : "pointer",
          }}
          title={!appliedOk ? "Apply Income to continue" : ""}
        >
          Next →
        </button>
      </div>

      {/* Household Income Toggle */}
      <div style={card}>
        <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={householdIncome}
            onChange={(e) => toggleHousehold(e.target.checked)}
            disabled={savingHI}
          />
          <span style={{ fontWeight: 800 }}>Household Income?</span>
          <span style={{ opacity: 0.65, fontSize: 13 }}>
            {householdIncome ? "Include Co-app income" : "Exclude Co-app income"}
          </span>
          {!appliedOk ? (
            <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.65 }}>
              (needs Apply)
            </span>
          ) : null}
        </label>
      </div>

      {/* Totals + Apply */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={pill}>
          Driver Applied: <b>{money(totals.primary)}</b>
        </div>
        <div style={pill}>
          Co-app Applied: <b>{money(totals.co)}</b>{" "}
          {!householdIncome ? <span style={{ opacity: 0.6 }}>(ignored)</span> : null}
        </div>
        <div style={pill}>
          Total Applied: <b>{money(totals.total)}</b>
        </div>

        <div style={{ flex: 1 }} />

        <button
          onClick={applyIncome}
          disabled={applying}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #111",
            background: applying ? "#999" : "#111",
            color: "#fff",
            cursor: applying ? "not-allowed" : "pointer",
            fontWeight: 800,
          }}
        >
          {applying ? "Applying…" : "Apply Income"}
        </button>
      </div>

      {applyResult ? (
        <div style={{ ...card, background: "#fafafa" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Applied Result</div>
            <div style={{ opacity: 0.7, fontSize: 13 }}>
              {appliedOk ? "✓ Applied (you can continue)" : "Not applied yet"}
            </div>
          </div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(applyResult.totals ?? applyResult, null, 2)}
          </pre>
        </div>
      ) : null}

      {/* Tabs + Add */}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setActiveRole("primary")} style={tabBtn(activeRole === "primary")}>
          Driver
        </button>
        <button onClick={() => setActiveRole("co")} style={tabBtn(activeRole === "co")}>
          Co-app
        </button>

        <div style={{ flex: 1 }} />

        <select
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value as IncomeType;
            if (!v) return;
            addIncome(activeRole, v);
            e.currentTarget.value = "";
          }}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            fontWeight: 700,
          }}
        >
          <option value="">+ Add Income Source…</option>
          <option value="w2">W2</option>
          <option value="self_employed">Self-Employed</option>
          <option value="fixed">Fixed</option>
          <option value="cash">Cash</option>
        </select>
      </div>

      {/* Income Cards */}
      <div style={{ display: "grid", gap: 12 }}>
        {activeRows.length === 0 ? (
          <div style={{ opacity: 0.75 }}>No income sources yet. Add one.</div>
        ) : null}

        {activeRows.map((row) => (
          <IncomeCard
            key={row.id}
            role={activeRole}
            row={row}
            saving={savingRowId === row.id}
            deleting={deletingRowId === row.id}
            w2Form={getW2Form(row.id)}
            onChangeW2={(next) => setW2Form(row.id, next)}
            onChange={(next) => {
              setAppliedOk(false); // any edit means re-apply
              setIncomes((prev) => ({
                ...prev,
                [activeRole]: prev[activeRole].map((x) => (x.id === row.id ? next : x)),
              }));
            }}
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
  saving: boolean;
  deleting: boolean;

  w2Form: W2Form;
  onChangeW2: (next: W2Form) => void;

  onChange: (next: IncomeRow) => void;

  onSave: () => void;
  onDelete: () => void;
}) {
  // Time on job:
  // - W2 uses hire_date -> pay_period_end
  // - others use hire_date -> today
  const timeOnJob = useMemo(() => {
    if (!row.hire_date) return "—";
    if (row.income_type === "w2") {
      const end = w2Form.payPeriodEnd || row.pay_period_end || "";
      return tenureLabelFromDates(row.hire_date, end || null);
    }
    return tenureLabelFromDates(row.hire_date, todayISO());
  }, [row.hire_date, row.income_type, row.pay_period_end, w2Form.payPeriodEnd]);

  // W2 calc
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
    <div style={card}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900 }}>{labelType(row.income_type)}</div>
        <div style={{ opacity: 0.6, fontSize: 13 }}>
          ({role === "primary" ? "Driver" : "Co-app"})
        </div>

        <div style={{ opacity: 0.75, fontSize: 13 }}>
          Time on job: <b>{timeOnJob}</b>
        </div>

        <div style={{ flex: 1 }} />

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={row.applied_to_deal}
            onChange={(e) => onChange({ ...row, applied_to_deal: e.target.checked })}
          />
          <span style={{ fontWeight: 700 }}>Applied</span>
        </label>

        <button onClick={onSave} disabled={saving} style={btnPrimary}>
          {saving ? "Saving…" : "Save"}
        </button>

        <button onClick={onDelete} disabled={deleting} style={btnDanger}>
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "220px 1fr",
          gap: 12,
          marginTop: 12,
        }}
      >
        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Income Type</div>
          <select
            value={row.income_type}
            onChange={(e) => onChange({ ...row, income_type: e.target.value as IncomeType })}
            style={input}
          >
            <option value="w2">W2</option>
            <option value="self_employed">Self-Employed</option>
            <option value="fixed">Fixed</option>
            <option value="cash">Cash</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Start Date (hire/start)</div>
          <input
            type="date"
            value={row.hire_date ?? ""}
            onChange={(e) => onChange({ ...row, hire_date: e.target.value || null })}
            style={input}
          />
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            Used for time on job. Non-W2 uses today automatically.
          </div>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Monthly Gross (manual)</div>
          <input
            value={row.monthly_gross_manual ?? ""}
            onChange={(e) =>
              onChange({
                ...row,
                monthly_gross_manual: e.target.value === "" ? null : toNumOrNull(e.target.value),
              })
            }
            placeholder="1.00"
            style={input}
          />
          <div style={{ fontSize: 12, opacity: 0.65 }}>
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
        <div style={{ marginTop: 14, borderTop: "1px solid #eee", paddingTop: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>W2 Calculator</div>

          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Hire Date</div>
                <input
                  type="date"
                  value={w2Form.hireDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChangeW2({ ...w2Form, hireDate: v });
                    onChange({ ...row, hire_date: v || null });
                  }}
                  style={input}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Pay Period End</div>
                <input
                  type="date"
                  value={w2Form.payPeriodEnd}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChangeW2({ ...w2Form, payPeriodEnd: v });
                    onChange({ ...row, pay_period_end: v || null });
                  }}
                  style={input}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Pay Frequency</div>
                <select
                  value={w2Form.payFrequency}
                  onChange={(e) => {
                    const v = e.target.value as PayFrequency;
                    onChangeW2({ ...w2Form, payFrequency: v });
                    onChange({ ...row, pay_frequency: v });
                  }}
                  style={input}
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="semimonthly">Semi-monthly</option>
                  <option value="monthly">Monthly</option>
                  <option value="annually">Annually</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Gross This Period</div>
                <input
                  value={w2Form.grossThisPeriod}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChangeW2({ ...w2Form, grossThisPeriod: v });
                    onChange({ ...row, gross_per_pay: toNumOrNull(v) });
                  }}
                  placeholder="1.00"
                  style={input}
                />
              </label>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, opacity: 0.75 }}>YTD Gross (optional)</div>
              <input
                value={w2Form.ytdGross}
                onChange={(e) => {
                  const v = e.target.value;
                  onChangeW2({ ...w2Form, ytdGross: v });
                  onChange({ ...row, gross_ytd: toNumOrNull(v) });
                }}
                placeholder="1.00"
                style={input}
              />
              <div style={{ fontSize: 12, opacity: 0.65 }}>
                {w2Calc ? (
                  <>
                    Tenure: <b>{w2Calc.tenureLabel}</b> · YTD start: <b>{w2Calc.ytdStartISO}</b>
                  </>
                ) : (
                  <>Enter dates to calculate tenure + YTD start.</>
                )}
              </div>
            </label>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div style={pill}>
                Monthly (annualized): <b>{w2Calc ? money(w2Calc.monthlyFromPaycheck) : "—"}</b>
              </div>

              <div style={pill}>
                Monthly (YTD avg):{" "}
                <b>{w2Calc && w2Calc.monthlyFromYtd > 0 ? money(w2Calc.monthlyFromYtd) : "—"}</b>
              </div>

              <div style={{ flex: 1 }} />

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
                style={{
                  ...btnPrimary,
                  opacity: canUseCalculated ? 1 : 0.5,
                  cursor: canUseCalculated ? "pointer" : "not-allowed",
                }}
              >
                Use Calculated
              </button>
            </div>

            {row.monthly_gross_calculated ? (
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Current calc value (preferred): <b>{money(row.monthly_gross_calculated)}</b>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  borderRadius: 14,
  padding: 14,
};

const pill: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 999,
  padding: "8px 12px",
  background: "#fafafa",
};

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: active ? "#111" : "#fff",
    color: active ? "#fff" : "#111",
    cursor: "pointer",
    fontWeight: 800,
  };
}

const input: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  fontWeight: 800,
};

const btnSecondary: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 800,
};

const btnDanger: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
  color: "crimson",
  cursor: "pointer",
  fontWeight: 800,
};