"use client";

import React, { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { DealStep } from "@/lib/deals/canAccessStep";

type VehicleCategory = "all" | "car" | "suv" | "truck" | "van";

type PayOption = {
  label: "NONE" | "VSC" | "GAP" | "VSC+GAP";
  include_vsc: boolean;
  include_gap: boolean;
  product_total?: number;
  amount_financed_est?: number;
  monthly_payment: number;
  term_months?: number;
  fits_cap: boolean;
  additional_down_needed: number;
  ltv_est?: number;
  checks?: {
    vehicle_price_ok: boolean;
    amount_financed_ok: boolean;
    ltv_ok: boolean;
    payment_ok: boolean;
  };
  fail_reasons?: string[];
  additional_down_breakdown?: {
    min_down: number;
    amount_financed: number;
    ltv: number;
    pti: number;
  };
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
    status?: string | null;
    date_in_stock: string | null;
    asking_price: number | null;
    jd_power_retail_book?: number | null;
    vehicle_category?: "car" | "suv" | "truck" | "van" | null;
    additional_down_required: number | null;
    vehicle_age_years?: number | null;
    vehicle_policy_max_term_months?: number | null;
    vehicle_term_policy_note?: string | null;
  };
  payment_options: PayOption[];
  assumptions: {
    apr: number;
    term_months: number;
    base_term_months?: number;
    max_payment_cap: number;
    cash_down_used: number;
    max_amount_financed?: number;
    trade_value?: number;
    trade_payoff?: number;
    trade_equity?: number;
    max_vehicle_price?: number;
    max_ltv?: number;
    tier?: string | null;
  };
};

type VehicleRow = {
  vehicle: ApiRow["vehicle"];
  assumptions: ApiRow["assumptions"];
  options: PayOption[];
  primaryBlock: string | null;
  fitsNow: boolean;
};

type Selected = {
  vehicleId: string;
  stock: string;
  year: string;
  make: string;
  model: string;
  option: PayOption;
};

type VehicleOptionsResponse = {
  ok?: boolean;
  rows?: ApiRow[];
  error?: string;
  details?: string;
  reason?: string;
  redirectTo?: DealStep;
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

function hasPriceError(vehicle: ApiRow["vehicle"]) {
  return vehicle.asking_price == null || Number(vehicle.asking_price) <= 0;
}

function normalizeReason(reason: string | null | undefined) {
  switch (reason) {
    case "PTI":
      return "Payment too high";
    case "LTV":
      return "LTV too high";
    case "AMOUNT_FINANCED":
      return "Amount financed too high";
    case "VEHICLE_PRICE":
      return "Vehicle price too high";
    default:
      return reason ?? "Does not fit";
  }
}

function optionSortValue(label: PayOption["label"]) {
  switch (label) {
    case "VSC+GAP":
      return 0;
    case "VSC":
      return 1;
    case "GAP":
      return 2;
    case "NONE":
      return 3;
    default:
      return 99;
  }
}

function getOptionReasonSummary(opt: PayOption) {
  if (opt.fits_cap) return null;

  const reasons = (opt.fail_reasons ?? []).map(normalizeReason).filter(Boolean);
  if (!reasons.length) return "Does not fit";

  return reasons.slice(0, 2).join(" • ");
}

function getOptionReasonDetail(opt: PayOption) {
  if (opt.fits_cap) return null;

  const parts: string[] = [];

  if (opt.additional_down_breakdown?.pti && opt.additional_down_breakdown.pti > 0) {
    parts.push(`Payment: +${money(opt.additional_down_breakdown.pti)}`);
  }
  if (opt.additional_down_breakdown?.ltv && opt.additional_down_breakdown.ltv > 0) {
    parts.push(`LTV: +${money(opt.additional_down_breakdown.ltv)}`);
  }
  if (
    opt.additional_down_breakdown?.amount_financed &&
    opt.additional_down_breakdown.amount_financed > 0
  ) {
    parts.push(`Amt Fin: +${money(opt.additional_down_breakdown.amount_financed)}`);
  }
  if (opt.additional_down_breakdown?.min_down && opt.additional_down_breakdown.min_down > 0) {
    parts.push(`Min Down: +${money(opt.additional_down_breakdown.min_down)}`);
  }

  return parts.length ? parts.slice(0, 2).join(" • ") : null;
}

function getOptionHoverText(opt: PayOption) {
  if (opt.fits_cap) return "✔ This structure works";

  const reasons = (opt.fail_reasons ?? []).map(normalizeReason).filter(Boolean);

  const lines: string[] = [];

  if (reasons.length) {
    lines.push(`Blocked by ${reasons[0]}`);
  } else {
    lines.push("Doesn’t fit program");
  }

  if (reasons.length > 1) {
    lines.push(`Also: ${reasons[1]}`);
  }

  if (opt.additional_down_breakdown) {
    const b = opt.additional_down_breakdown;

    if (b.min_down > 0) {
      lines.push(`Add ${money(b.min_down)} down`);
    }

    if (b.pti > 0) {
      lines.push(`Over payment cap by ${money(b.pti)}`);
    }

    if (b.ltv > 0) {
      lines.push(`Over LTV by ${money(b.ltv)}`);
    }

    if (b.amount_financed > 0) {
      lines.push(`Amount financed too high by ${money(b.amount_financed)}`);
    }
  }

  return lines.join("\n");
}

export default function DealVehiclePage() {
  const params = useParams();
  const dealId = asString(params?.dealId);
  const router = useRouter();

  const [rows, setRows] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [cashDownInput, setCashDownInput] = useState<string>("");
  const [cashDownApplied, setCashDownApplied] = useState<number | null>(null);
  const [tradeValueInput, setTradeValueInput] = useState<string>("");
  const [tradePayoffInput, setTradePayoffInput] = useState<string>("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>("all");

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
      let json: VehicleOptionsResponse = {};

      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        // ignore non-json
      }

      if (!res.ok) {
        if (json?.error === "STEP_BLOCKED" && json?.redirectTo) {
          router.replace(`/deals/${dealId}/${json.redirectTo}`);
          return;
        }

        throw new Error(json?.error || json?.details || text || "Failed to load vehicles");
      }

      const incoming: ApiRow[] = json.rows || [];
      setRows(incoming);

      const serverDown = incoming?.[0]?.assumptions?.cash_down_used;
      if (cashDownApplied == null && serverDown != null) {
        setCashDownApplied(Number(serverDown));
        setCashDownInput(String(serverDown));
      }
      const serverTradeValue = incoming?.[0]?.assumptions?.trade_value;
      if (serverTradeValue != null) {
        setTradeValueInput(String(serverTradeValue));
      }

      const serverTradePayoff = incoming?.[0]?.assumptions?.trade_payoff;
      if (serverTradePayoff != null) {
        setTradePayoffInput(String(serverTradePayoff));
      }
      setSelected(null);
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!dealId) return;
    void load(cashDownApplied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const header = rows[0]?.assumptions;

  const incomeAppliedOk = useMemo(() => {
    const cap = header?.max_payment_cap;
    return typeof cap === "number" && Number.isFinite(cap) && cap > 0;
  }, [header?.max_payment_cap]);

  const vehicles: VehicleRow[] = useMemo(() => {
    const out: VehicleRow[] = rows.map((r) => {
      const options = [...r.payment_options].sort(
        (a, b) => optionSortValue(a.label) - optionSortValue(b.label)
      );

      const fits = options
        .filter((x) => x.fits_cap)
        .sort((a, b) => a.monthly_payment - b.monthly_payment);

      const bestPathOption = options.length
        ? [...options].sort((a, b) => {
          const aDown = a.additional_down_needed ?? Infinity;
          const bDown = b.additional_down_needed ?? Infinity;
          if (aDown !== bDown) return aDown - bDown;
          return a.monthly_payment - b.monthly_payment;
        })[0]
        : undefined;

      const primaryBlock = bestPathOption?.fail_reasons?.length
        ? bestPathOption.fail_reasons[0]
        : null;

      return {
        vehicle: r.vehicle,
        assumptions: r.assumptions,
        options,
        primaryBlock,
        fitsNow: fits.length > 0,
      };
    });

    out.sort((a, b) => {
      const blockRank = (block: string | null) => {
        switch (block) {
          case null:
            return 0;
          case "LTV":
            return 1;
          case "AMOUNT_FINANCED":
            return 2;
          case "VEHICLE_PRICE":
            return 3;
          case "PTI":
            return 4;
          default:
            return 5;
        }
      };

      if (a.fitsNow !== b.fitsNow) return a.fitsNow ? -1 : 1;

      const aBlock = blockRank(a.primaryBlock);
      const bBlock = blockRank(b.primaryBlock);
      if (aBlock !== bBlock) return aBlock - bBlock;

      const aBestDown = Math.min(...a.options.map((o) => o.additional_down_needed ?? Infinity));
      const bBestDown = Math.min(...b.options.map((o) => o.additional_down_needed ?? Infinity));
      if (aBestDown !== bBestDown) return aBestDown - bBestDown;

      const aBestPmt = Math.min(...a.options.map((o) => o.monthly_payment ?? Infinity));
      const bBestPmt = Math.min(...b.options.map((o) => o.monthly_payment ?? Infinity));
      if (aBestPmt !== bBestPmt) return aBestPmt - bBestPmt;

      const aAge = daysSince(a.vehicle.date_in_stock) ?? 0;
      const bAge = daysSince(b.vehicle.date_in_stock) ?? 0;
      return bAge - aAge;
    });

    return out;
  }, [rows]);

  const vehicleCategoryCounts = useMemo(() => {
    const counts = {
      all: vehicles.length,
      car: 0,
      suv: 0,
      truck: 0,
      van: 0,
    };

    for (const v of vehicles) {
      const cat = v.vehicle.vehicle_category ?? "car";

      if (cat === "car") counts.car += 1;
      else if (cat === "suv") counts.suv += 1;
      else if (cat === "truck") counts.truck += 1;
      else if (cat === "van") counts.van += 1;
    }

    return counts;
  }, [vehicles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return vehicles.filter((v) => {
      const matchesCategory =
        vehicleCategory === "all" ||
        (v.vehicle.vehicle_category ?? "car") === vehicleCategory;

      if (!matchesCategory) return false;

      if (!q) return true;

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
  }, [vehicles, query, vehicleCategory]);

  async function handleApplyDealInputs() {
    const cashDown = Number(cashDownInput || 0);
    const tradeValue = Number(tradeValueInput || 0);
    const tradePayoff = Number(tradePayoffInput || 0);

    if (Number.isNaN(cashDown) || cashDown < 0) {
      setErr("Cash down must be a valid non-negative number.");
      return;
    }

    if (Number.isNaN(tradeValue) || tradeValue < 0) {
      setErr("Trade in must be a valid non-negative number.");
      return;
    }

    if (Number.isNaN(tradePayoff) || tradePayoff < 0) {
      setErr("Trade payoff must be a valid non-negative number.");
      return;
    }

    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cash_down: cashDown,
          trade_value: tradeValue,
          trade_payoff: tradePayoff,
          has_trade: tradeValue > 0 || tradePayoff > 0,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save deal inputs");
      }

      setCashDownApplied(cashDown);
      await load(cashDown);
    } catch (e) {
      console.error(e);
      setErr("Failed to save deal inputs");
    }
  }
  const tradeEquityPreview =
    (Number(tradeValueInput || 0) || 0) - (Number(tradePayoffInput || 0) || 0);

  function buildDealUrl(sel: Selected) {
    const qs = new URLSearchParams();
    qs.set("vehicleId", sel.vehicleId);
    qs.set("option", sel.option.label);
    qs.set("vsc", String(sel.option.include_vsc));
    qs.set("gap", String(sel.option.include_gap));

    if (cashDownApplied != null) {
      qs.set("cashDown", String(cashDownApplied));
    }

    return `/deals/${dealId}/deal?${qs.toString()}`;
  }

  function onPrev() {
    router.push(`/deals/${dealId}/income`);
  }

  function onNext() {
    if (!incomeAppliedOk) {
      setErr("Income totals are not ready yet. Go back to Step 2 and let income finish updating.");
      return;
    }

    if (!selected) {
      setErr("Select a vehicle option to continue.");
      return;
    }

    router.push(buildDealUrl(selected));
  }

  function onPick(v: VehicleRow, opt: PayOption) {
    if (!incomeAppliedOk) {
      setErr("Income totals are not ready yet. Go back to Step 2 and let income finish updating.");
      return;
    }

    if (hasPriceError(v.vehicle)) {
      setErr("Vehicle is not priced yet.");
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
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Step 3: Vehicle</h2>

        {header ? (
          <div style={{ marginLeft: 6, fontSize: 14, opacity: 0.85 }}>
            APR: <b>{Number(header.apr ?? 0).toFixed(2)}%</b> • Vehicle terms are capped by
            mileage/age policy • Max Payment: <b>{money(header.max_payment_cap)}</b>
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
          title={
            !incomeAppliedOk
              ? "Wait for Step 2 income totals to finish updating"
              : !selected
                ? "Pick an option"
                : ""
          }
        >
          Next →
        </button>
      </div>

      {!loading && !incomeAppliedOk ? (
        <div style={{ ...card, borderColor: "#f2c9c9", background: "#fff7f7" }}>
          <div style={{ fontWeight: 900, color: "crimson" }}>Income totals are not ready yet.</div>
          <div style={{ marginTop: 6, opacity: 0.85 }}>
            Go back to <b>Step 2</b> and let the income step finish saving and updating totals.
            Until then, vehicle options are locked.
          </div>
        </div>
      ) : null}

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
              ({selected.option.label}) {money(selected.option.monthly_payment)}/mo •{" "}
              {selected.option.term_months ?? "—"} mo
            </div>

            <div style={{ flex: 1 }} />

            <button type="button" onClick={() => setSelected(null)} style={btnSecondary}>
              Clear
            </button>
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Cash Down</div>
          <input
            value={cashDownInput}
            onChange={(e) => setCashDownInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleApplyDealInputs();
            }}
            placeholder="1.00"
            style={input}
          />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Trade In</div>
          <input
            value={tradeValueInput}
            onChange={(e) => setTradeValueInput(e.target.value)}
            placeholder="0.00"
            style={input}
          />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Trade Payoff</div>
          <input
            value={tradePayoffInput}
            onChange={(e) => setTradePayoffInput(e.target.value)}
            placeholder="0.00"
            style={input}
          />
        </div>

        <button type="button" onClick={handleApplyDealInputs} style={btnSecondary}>
          Apply
        </button>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {(
            [
              { key: "all", label: "All" },
              { key: "car", label: "Cars" },
              { key: "suv", label: "SUVs" },
              { key: "truck", label: "Trucks" },
              { key: "van", label: "Vans" },
            ] as Array<{ key: VehicleCategory; label: string }>
          ).map((item) => {
            const active = vehicleCategory === item.key;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setVehicleCategory(item.key)}
                style={{
                  ...filterBtn,
                  background: active ? "#e8f0fe" : "#fff",
                  borderColor: active ? "#7aa2e3" : "#d8d8d8",
                  color: active ? "#0f3d91" : "#222",
                  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                }}
              >
                {item.label} ({vehicleCategoryCounts[item.key]})
              </button>
            );
          })}
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stock / year / make / model / VIN..."
          style={{ ...input, flex: 1, minWidth: 260 }}
        />
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.85 }}>
        Trade Equity:{" "}
        <span
          style={{
            color: tradeEquityPreview > 0 ? "green" : tradeEquityPreview < 0 ? "crimson" : "#444",
          }}
        >
          {money(tradeEquityPreview)}
        </span>
      </div>

      {loading ? <div style={{ opacity: 0.8 }}>Loading…</div> : null}
      {err ? <div style={{ color: "crimson" }}>{err}</div> : null}

      {!loading && !err ? (
        <div
          style={{
            border: "1px solid #eee",
            borderRadius: 12,
            width: "100%",
            overflowX: "auto",
            background: "#fff",
          }}
        >
          <table
            style={{
              width: "100%",
              minWidth: 1320,
              borderCollapse: "collapse",
              fontSize: 14,
            }}
          >
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th colSpan={7} style={{ ...th, textAlign: "center" }}>
                  Vehicle Information
                </th>
                <th colSpan={5} style={{ ...th, textAlign: "center" }}>
                  Payment Information
                </th>
              </tr>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ ...th, width: 42 }}>Age</th>
                <th style={{ ...th, width: 88 }}>Stock #</th>
                <th style={{ ...th, width: 62 }}>Year</th>
                <th style={{ ...th, width: 95 }}>Make</th>
                <th style={{ ...th, width: 145 }}>Model</th>
                <th style={{ ...th, width: 105 }}>Mileage</th>
                <th style={{ ...th, width: 82 }}>Block</th>

                <th style={{ ...thCenter, width: 42, paddingLeft: 4, paddingRight: 4 }}>VSC</th>
                <th style={{ ...thCenter, width: 42, paddingLeft: 4, paddingRight: 4 }}>GAP</th>
                <th style={{ ...thCenter, width: 60 }}>Term</th>
                <th style={{ ...thRight, width: 170 }}>Monthly Payment</th>
                <th style={{ ...thRight, width: 170 }}>Additional Down</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((v) => {
                const age = daysSince(v.vehicle.date_in_stock);
                const rowSpan = v.options.length;
                const priceError = hasPriceError(v.vehicle);

                return (
                  <Fragment key={v.vehicle.id}>
                    {v.options.map((opt, idx) => {
                      const ok = opt.fits_cap;
                      const needsMoreDown = !ok && (opt.additional_down_needed ?? 0) > 0;
                      const isSelected =
                        selected?.vehicleId === v.vehicle.id &&
                        selected?.option?.label === opt.label;

                      return (
                        <tr
                          key={`${v.vehicle.id}-${opt.label}`}
                          style={{
                            background: priceError ? "#fff7e6" : v.fitsNow ? "#f8fff9" : "#fff",
                          }}
                        >
                          {idx === 0 ? (
                            <>
                              <td
                                rowSpan={rowSpan}
                                style={{ ...tdTop, width: 42, paddingLeft: 6, paddingRight: 6 }}
                              >
                                {age == null ? "—" : age}
                              </td>
                              <td rowSpan={rowSpan} style={tdTop}>
                                {v.vehicle.stock_number ?? "—"}
                              </td>
                              <td rowSpan={rowSpan} style={tdTop}>
                                {v.vehicle.year ?? "—"}
                              </td>
                              <td rowSpan={rowSpan} style={tdTop}>
                                {v.vehicle.make ?? "—"}
                              </td>
                              <td rowSpan={rowSpan} style={tdTop}>
                                {v.vehicle.model ?? "—"}
                              </td>
                              <td rowSpan={rowSpan} style={tdTop}>
                                {v.vehicle.odometer != null ? num(v.vehicle.odometer) : "—"}
                              </td>
                              <td rowSpan={rowSpan} style={tdTop}>
                                {priceError ? (
                                  <span
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 800,
                                      color: "#b45309",
                                    }}
                                  >
                                    No Price
                                  </span>
                                ) : v.primaryBlock ? (
                                  <span
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 800,
                                      color: "crimson",
                                    }}
                                  >
                                    {normalizeReason(v.primaryBlock)}
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 800,
                                      color: "green",
                                    }}
                                  >
                                    OK
                                  </span>
                                )}
                              </td>
                            </>
                          ) : null}

                          <td style={{ ...tdCenter, paddingLeft: 4, paddingRight: 4 }}>
                            {opt.include_vsc ? "✓" : ""}
                          </td>
                          <td style={{ ...tdCenter, paddingLeft: 4, paddingRight: 4 }}>
                            {opt.include_gap ? "✓" : ""}
                          </td>
                          <td style={tdCenter}>{opt.term_months ?? "—"}</td>

                          <td style={tdRight}>
                            <button
                              type="button"
                              disabled={!incomeAppliedOk || priceError}
                              onClick={() => onPick(v, opt)}
                              style={{
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                cursor: !incomeAppliedOk || priceError ? "not-allowed" : "pointer",
                                fontWeight: 900,
                                fontSize: 15,
                                textDecoration: "underline",
                                opacity: !incomeAppliedOk || priceError ? 0.35 : ok ? 1 : 0.7,
                                color: ok ? "#111" : "#666",
                              }}
                              title={
                                !incomeAppliedOk
                                  ? "Income totals not ready"
                                  : priceError
                                    ? "Vehicle is not priced yet"
                                    : getOptionHoverText(opt)
                              }
                            >
                              {money(opt.monthly_payment)}
                            </button>

                            <span
                              style={{
                                marginLeft: 6,
                                fontWeight: 900,
                                color: ok ? "green" : needsMoreDown ? "#d97706" : "crimson",
                              }}
                            >
                              {ok ? "✓" : needsMoreDown ? "!" : "✕"}
                            </span>

                            {isSelected ? (
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 800,
                                  color: "#111",
                                  marginTop: 2,
                                }}
                              >
                                selected
                              </div>
                            ) : null}
                          </td>

                          <td style={tdRight}>
                            {needsMoreDown ? (
                              <span style={{ color: "#d97706", fontWeight: 800 }}>
                                +{money(opt.additional_down_needed)}
                              </span>
                            ) : ok ? (
                              <span style={{ color: "#666" }}>—</span>
                            ) : (
                              <span style={{ color: "crimson", fontWeight: 800 }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
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
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const thCenter: React.CSSProperties = {
  ...th,
  textAlign: "center",
};

const thRight: React.CSSProperties = {
  ...th,
  textAlign: "right",
};

const tdBase: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #f2f2f2",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};

const tdTop: React.CSSProperties = {
  ...tdBase,
  verticalAlign: "top",
  paddingTop: 8,
};

const tdCenter: React.CSSProperties = {
  ...tdBase,
  textAlign: "center",
};

const tdRight: React.CSSProperties = {
  ...tdBase,
  textAlign: "right",
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

const filterBtn: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 12,
  border: "1px solid #d8d8d8",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 800,
  minWidth: 72,
};

const btnSecondary: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 900,
};
