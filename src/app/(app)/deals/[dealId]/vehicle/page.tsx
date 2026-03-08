"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type PayOption = {
  label: "NONE" | "VSC" | "GAP" | "VSC+GAP";
  include_vsc: boolean;
  include_gap: boolean;
  monthly_payment: number;
  fits_cap: boolean;
  additional_down_needed: number;
};

type ApiRow = {
  vehicle: {
    id: string;
    stock_number: string | null;
    vin: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
    odometer: number | null;
    date_in_stock: string | null;
    asking_price: number | null;
    additional_down_required: number | null;
  };
  payment_options: PayOption[];
  assumptions: {
    apr: number;
    term_months: number;
    max_payment_cap: number; // from income apply
    cash_down_used: number;
  };
};

type VehicleRow = {
  vehicle: ApiRow["vehicle"];
  assumptions: ApiRow["assumptions"];
  byLabel: Partial<Record<PayOption["label"], PayOption>>;
  bestLabel?: PayOption["label"];
};

type Selected = {
  vehicleId: string;
  stock: string;
  year: string;
  make: string;
  model: string;
  option: PayOption;
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

function daysSince(dateIso: string | null | undefined) {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export default function DealVehiclePage() {
  const params = useParams();
  const dealId = asString(params?.dealId);
  const router = useRouter();

  const [rows, setRows] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Down payment controls
  const [cashDownInput, setCashDownInput] = useState<string>("");
  const [cashDownApplied, setCashDownApplied] = useState<number | null>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);

  async function load(cashDown: number | null) {
    if (!dealId) return;

    setLoading(true);
    setErr(null);

    try {
      const qs = new URLSearchParams();
      qs.set("limit", "500");
      if (cashDown != null && !Number.isNaN(cashDown)) {
        qs.set("cashDown", String(cashDown));
      }

      const res = await fetch(`/api/deals/${dealId}/vehicles/options?${qs.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      const text = await res.text();
      let json: any = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        // non-json response
      }

      if (!res.ok) throw new Error(json?.error || json?.details || text || "Failed to load vehicles");

      const incoming: ApiRow[] = json.rows || [];
      setRows(incoming);

      // Initialize input from server on first load
      const serverDown = incoming?.[0]?.assumptions?.cash_down_used;
      if (cashDownApplied == null && serverDown != null && cashDownInput === "") {
        setCashDownInput(String(serverDown));
      }

      // If cash down changed, selection is potentially invalid -> clear selection
      setSelected(null);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!dealId) return;
    load(cashDownApplied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const header = rows[0]?.assumptions;

  const incomeAppliedOk = useMemo(() => {
    const cap = header?.max_payment_cap;
    return typeof cap === "number" && Number.isFinite(cap) && cap > 0;
  }, [header?.max_payment_cap]);

  const vehicles: VehicleRow[] = useMemo(() => {
    const out: VehicleRow[] = rows.map((r) => {
      const byLabel: VehicleRow["byLabel"] = {};
      for (const o of r.payment_options) byLabel[o.label] = o;

      const fits = Object.values(byLabel).filter((x): x is PayOption => Boolean(x) && x.fits_cap);
      fits.sort((a, b) => a.monthly_payment - b.monthly_payment);
      const best = fits[0]?.label;

      return { vehicle: r.vehicle, assumptions: r.assumptions, byLabel, bestLabel: best };
    });

    out.sort((a, b) => {
      const aBest = a.bestLabel ? a.byLabel[a.bestLabel]?.monthly_payment ?? Infinity : Infinity;
      const bBest = b.bestLabel ? b.byLabel[b.bestLabel]?.monthly_payment ?? Infinity : Infinity;

      const aHasFit = Number.isFinite(aBest);
      const bHasFit = Number.isFinite(bBest);

      if (aHasFit !== bHasFit) return aHasFit ? -1 : 1;
      return aBest - bBest;
    });

    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vehicles;

    return vehicles.filter((v) => {
      const hay = [
        v.vehicle.stock_number,
        v.vehicle.year?.toString(),
        v.vehicle.make,
        v.vehicle.model,
        v.vehicle.vin,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    });
  }, [vehicles, query]);

  async function handleApplyDown() {
    const n = Number(cashDownInput);
    if (Number.isNaN(n) || n < 0) {
      setErr("Cash down must be a valid non-negative number.");
      return;
    }
    setCashDownApplied(n);
    await load(n);
  }

  function buildDealUrl(sel: Selected) {
    const qs = new URLSearchParams();
    qs.set("vehicleId", sel.vehicleId);
    qs.set("option", sel.option.label);
    qs.set("vsc", String(sel.option.include_vsc));
    qs.set("gap", String(sel.option.include_gap));
    qs.set("term", String(header?.term_months ?? ""));
    qs.set("pmt", String(sel.option.monthly_payment));
    if (cashDownApplied != null) qs.set("cashDown", String(cashDownApplied));
    return `/deals/${dealId}/deal?${qs.toString()}`;
  }

  function onPrev() {
    router.push(`/deals/${dealId}/income`);
  }

  function onNext() {
    if (!incomeAppliedOk) {
      setErr("Income has not been applied. Go back to Step 2 and click 'Apply Income'.");
      return;
    }
    if (!selected) {
      setErr("Select a vehicle payment option to continue.");
      return;
    }
    router.push(buildDealUrl(selected));
  }

  function onPick(v: VehicleRow, opt: PayOption) {
    if (!incomeAppliedOk) {
      setErr("Income has not been applied. Go back to Step 2 and click 'Apply Income'.");
      return;
    }

    setErr(null);

    setSelected({
      vehicleId: v.vehicle.id,
      stock: v.vehicle.stock_number ?? "—",
      year: v.vehicle.year?.toString() ?? "—",
      make: v.vehicle.make ?? "—",
      model: v.vehicle.model ?? "—",
      option: opt,
    });
  }

  function PayCell({
    vRow,
    opt,
    highlight,
  }: {
    vRow: VehicleRow;
    opt?: PayOption;
    highlight?: boolean;
  }) {
    if (!opt) return <td style={tdPayMuted}>—</td>;

    const ok = opt.fits_cap;
    const txt = money(opt.monthly_payment);
    const isSelected =
      selected?.vehicleId === vRow.vehicle.id && selected?.option?.label === opt.label;

    const disabled = !incomeAppliedOk;

    return (
      <td style={tdPay}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPick(vRow, opt)}
          style={{
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: disabled ? "not-allowed" : "pointer",
            fontWeight: 900,
            textDecoration: "underline",
            opacity: disabled ? 0.35 : ok ? 1 : 0.55,
          }}
          title={
            disabled
              ? "Income not applied"
              : ok
              ? "Select this option"
              : `Needs +${money(opt.additional_down_needed)} down to fit`
          }
        >
          {txt}
        </button>

        <span
          style={{
            marginLeft: 6,
            fontWeight: 900,
            color: ok ? "green" : "crimson",
            opacity: disabled ? 0.35 : 1,
          }}
        >
          {ok ? "✓" : "✕"}
        </span>

        {!disabled && !ok && opt.additional_down_needed > 0 ? (
          <div style={{ fontSize: 12, color: "crimson", fontWeight: 800 }}>
            +{money(opt.additional_down_needed)}
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: disabled ? 0.35 : 0.65, fontWeight: 700 }}>
            {isSelected ? "selected" : highlight ? "best" : "\u00A0"}
          </div>
        )}
      </td>
    );
  }

  if (!dealId) {
    return (
      <div style={{ padding: 16, color: "crimson" }}>
        Missing dealId in route params. (Check folder name: <code>deals/[dealId]/vehicle</code>)
      </div>
    );
  }

  const nextDisabled = !incomeAppliedOk || !selected || loading;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Header + Prev/Next */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Step 3: Vehicle</h2>

        {header ? (
          <div style={{ marginLeft: 6, fontSize: 14, opacity: 0.85 }}>
            APR: <b>{header.apr}%</b> • Term: <b>{header.term_months}</b> • Max Payment:{" "}
            <b>{money(header.max_payment_cap)}</b>
          </div>
        ) : null}

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
          title={!incomeAppliedOk ? "Apply Income in Step 2" : !selected ? "Pick an option" : ""}
        >
          Next →
        </button>
      </div>

      {/* Gating message */}
      {!loading && !incomeAppliedOk ? (
        <div style={{ ...card, borderColor: "#f2c9c9", background: "#fff7f7" }}>
          <div style={{ fontWeight: 900, color: "crimson" }}>
            Income isn’t applied yet.
          </div>
          <div style={{ marginTop: 6, opacity: 0.85 }}>
            Go back to <b>Step 2</b> and click <b>Apply Income</b>. Until then, vehicle options are locked.
          </div>
        </div>
      ) : null}

      {/* Selected banner */}
      {selected ? (
        <div style={{ ...card, background: "#fafafa" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900 }}>Selected:</div>
            <div>
              <b>
                {selected.stock} • {selected.year} {selected.make} {selected.model}
              </b>
            </div>
            <div style={{ opacity: 0.75 }}>
              ({selected.option.label}) {money(selected.option.monthly_payment)}/mo
            </div>

            <div style={{ flex: 1 }} />

            <button type="button" onClick={() => setSelected(null)} style={btnSecondary}>
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {/* Top controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Cash Down</div>
          <input
            value={cashDownInput}
            onChange={(e) => setCashDownInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleApplyDown();
            }}
            placeholder="1.00"
            style={input}
          />
          <button type="button" onClick={handleApplyDown} style={btnSecondary}>
            Apply
          </button>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stock / year / make / model / VIN..."
          style={{ ...input, flex: 1, minWidth: 260 }}
        />
      </div>

      {loading ? <div style={{ opacity: 0.8 }}>Loading…</div> : null}
      {err ? <div style={{ color: "crimson" }}>{err}</div> : null}

      {!loading && !err ? (
        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={th}>Age</th>
                <th style={th}>Stock #</th>
                <th style={th}>Year</th>
                <th style={th}>Make</th>
                <th style={th}>Model</th>
                <th style={th}>Odo</th>
                <th style={th}>Addl Down</th>

                <th style={thPay}>VSC+GAP</th>
                <th style={thPay}>VSC</th>
                <th style={thPay}>GAP</th>
                <th style={thPay}>NONE</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const age = daysSince(v.vehicle.date_in_stock);

                const optVG = v.byLabel["VSC+GAP"];
                const optV = v.byLabel["VSC"];
                const optG = v.byLabel["GAP"];
                const optN = v.byLabel["NONE"];

                return (
                  <tr key={v.vehicle.id} style={{ background: "#fff" }}>
                    <td style={td}>{age == null ? "—" : age}</td>
                    <td style={td}>{v.vehicle.stock_number ?? "—"}</td>
                    <td style={td}>{v.vehicle.year ?? "—"}</td>
                    <td style={td}>{v.vehicle.make ?? "—"}</td>
                    <td style={td}>{v.vehicle.model ?? "—"}</td>
                    <td style={td}>{v.vehicle.odometer != null ? num(v.vehicle.odometer) : "—"}</td>

                    <td style={td}>
                     {v.vehicle.additional_down_required && v.vehicle.additional_down_required > 0
                    ? money(v.vehicle.additional_down_required)
                    : "—"}
                  </td>

                    <PayCell vRow={v} opt={optVG} highlight={v.bestLabel === "VSC+GAP"} />
                    <PayCell vRow={v} opt={optV} highlight={v.bestLabel === "VSC"} />
                    <PayCell vRow={v} opt={optG} highlight={v.bestLabel === "GAP"} />
                    <PayCell vRow={v} opt={optN} highlight={v.bestLabel === "NONE"} />
                  </tr>
                );
              })}
            </tbody>
          </table>
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

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 10px",
  borderBottom: "1px solid #eee",
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "10px 10px",
  borderBottom: "1px solid #f2f2f2",
  whiteSpace: "nowrap",
};

const thPay: React.CSSProperties = {
  ...th,
  textAlign: "center",
  minWidth: 140,
};

const tdPay: React.CSSProperties = {
  ...td,
  textAlign: "center",
  verticalAlign: "top",
};

const tdPayMuted: React.CSSProperties = {
  ...tdPay,
  opacity: 0.5,
};

const input: React.CSSProperties = {
  width: 140,
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