"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
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
      return "PTI fail";
    case "LTV":
      return "LTV high";
    case "AMOUNT_FINANCED":
      return "Amt financed high";
    case "VEHICLE_PRICE":
      return "Price high";
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

  return reasons.slice(0, 2).join(" / ");
}

function getOptionReasonDetail(opt: PayOption) {
  if (opt.fits_cap) return null;

  const parts: string[] = [];

  if (opt.additional_down_breakdown?.pti && opt.additional_down_breakdown.pti > 0) {
    parts.push(`PTI +${money(opt.additional_down_breakdown.pti)}`);
  }
  if (opt.additional_down_breakdown?.ltv && opt.additional_down_breakdown.ltv > 0) {
    parts.push(`LTV +${money(opt.additional_down_breakdown.ltv)}`);
  }
  if (
    opt.additional_down_breakdown?.amount_financed &&
    opt.additional_down_breakdown.amount_financed > 0
  ) {
    parts.push(`Amt Fin +${money(opt.additional_down_breakdown.amount_financed)}`);
  }
  if (opt.additional_down_breakdown?.min_down && opt.additional_down_breakdown.min_down > 0) {
    parts.push(`Down +${money(opt.additional_down_breakdown.min_down)}`);
  }

  return parts.length ? parts.slice(0, 2).join(" / ") : null;
}

function getOptionHoverText(opt: PayOption) {
  if (opt.fits_cap) return "This structure works";

  const reasons = (opt.fail_reasons ?? []).map(normalizeReason).filter(Boolean);
  const lines: string[] = [];

  if (reasons.length) {
    lines.push(`Blocked by ${reasons[0]}`);
  } else {
    lines.push("Does not fit program");
  }

  if (reasons.length > 1) {
    lines.push(`Also: ${reasons[1]}`);
  }

  if (opt.additional_down_breakdown) {
    const b = opt.additional_down_breakdown;

    if (b.min_down > 0) lines.push(`Add ${money(b.min_down)} down`);
    if (b.pti > 0) lines.push(`Over payment cap by ${money(b.pti)}`);
    if (b.ltv > 0) lines.push(`Over LTV by ${money(b.ltv)}`);
    if (b.amount_financed > 0) {
      lines.push(`Amount financed too high by ${money(b.amount_financed)}`);
    }
  }

  return lines.join("\n");
}

function getOptionBadgeVariant(opt: PayOption): "success" | "warning" | "destructive" {
  if (opt.fits_cap) return "success";
  if ((opt.additional_down_needed ?? 0) > 0) return "warning";
  return "destructive";
}

function getStatusLabel(opt: PayOption) {
  if (opt.fits_cap) return "Works";
  if ((opt.additional_down_needed ?? 0) > 0) return "More down";
  return getOptionReasonSummary(opt) ?? "Blocked";
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
  const [dealInputSaveState, setDealInputSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>("all");
  const [activeOptionByVehicle, setActiveOptionByVehicle] = useState<Record<string, PayOption["label"]>>(
    {}
  );
  const autosaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSequenceRef = React.useRef(0);
  const skipAutosaveRef = React.useRef(true);
  const saveBadgeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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
        skipAutosaveRef.current = true;
        setCashDownApplied(Number(serverDown));
        setCashDownInput(String(serverDown));
      }

      const serverTradeValue = incoming?.[0]?.assumptions?.trade_value;
      if (serverTradeValue != null) {
        skipAutosaveRef.current = true;
        setTradeValueInput(String(serverTradeValue));
      }

      const serverTradePayoff = incoming?.[0]?.assumptions?.trade_payoff;
      if (serverTradePayoff != null) {
        skipAutosaveRef.current = true;
        setTradePayoffInput(String(serverTradePayoff));
      }

      setSelected(null);
      setActiveOptionByVehicle({});
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!dealId) return;
    queueMicrotask(() => {
      void load(cashDownApplied);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      if (saveBadgeTimerRef.current) clearTimeout(saveBadgeTimerRef.current);
    };
  }, []);

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
        vehicleCategory === "all" || (v.vehicle.vehicle_category ?? "car") === vehicleCategory;

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

  const bestVehicleId = filtered[0]?.vehicle.id ?? null;

  async function saveDealInputs(opts?: { silent?: boolean }) {
    const cashDown = Number(cashDownInput || 0);
    const tradeValue = Number(tradeValueInput || 0);
    const tradePayoff = Number(tradePayoffInput || 0);
    const silent = !!opts?.silent;

    if (Number.isNaN(cashDown) || cashDown < 0) {
      if (!silent) setErr("Cash down must be a valid non-negative number.");
      setDealInputSaveState("error");
      return;
    }

    if (Number.isNaN(tradeValue) || tradeValue < 0) {
      if (!silent) setErr("Trade in must be a valid non-negative number.");
      setDealInputSaveState("error");
      return;
    }

    if (Number.isNaN(tradePayoff) || tradePayoff < 0) {
      if (!silent) setErr("Trade payoff must be a valid non-negative number.");
      setDealInputSaveState("error");
      return;
    }

    const seq = ++saveSequenceRef.current;
    setDealInputSaveState("saving");
    if (!silent) setErr(null);

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

      const json: VehicleOptionsResponse = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (json?.error === "STEP_BLOCKED" && json?.redirectTo) {
          router.replace(`/deals/${dealId}/${json.redirectTo}`);
          return;
        }

        throw new Error(json?.error || json?.details || "Failed to save deal inputs");
      }

      setCashDownApplied(cashDown);
      await load(cashDown);
      if (saveSequenceRef.current !== seq) return;
      setDealInputSaveState("saved");
      if (saveBadgeTimerRef.current) clearTimeout(saveBadgeTimerRef.current);
      saveBadgeTimerRef.current = setTimeout(() => {
        setDealInputSaveState((current) => (current === "saved" ? "idle" : current));
      }, 1500);
    } catch (e) {
      console.error(e);
      if (saveSequenceRef.current !== seq) return;
      setDealInputSaveState("error");
      setErr("Failed to save deal inputs");
    }
  }

  async function handleApplyDealInputs() {
    await saveDealInputs();
  }

  useEffect(() => {
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }

    if (loading) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(() => {
      void saveDealInputs({ silent: true });
    }, 900);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashDownInput]);

  const tradeEquityPreview =
    (Number(tradeValueInput || 0) || 0) - (Number(tradePayoffInput || 0) || 0);

  function buildDealUrl(sel: Selected) {
    const qs = new URLSearchParams();
    qs.set("vehicleId", sel.vehicleId);
    qs.set("option", sel.option.label);
    qs.set("vsc", String(sel.option.include_vsc));
    qs.set("gap", String(sel.option.include_gap));
    qs.set("termMonths", String(sel.option.term_months ?? ""));
    qs.set("monthlyPayment", String(sel.option.monthly_payment ?? ""));

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
    setActiveOptionByVehicle((current) => ({ ...current, [v.vehicle.id]: opt.label }));

    setSelected({
      vehicleId: v.vehicle.id,
      stock: v.vehicle.stock_number ?? "-",
      year: v.vehicle.year?.toString() ?? "-",
      make: v.vehicle.make ?? "-",
      model: v.vehicle.model ?? "-",
      option: opt,
    });
  }

  function getActiveOption(v: VehicleRow) {
    if (
      selected?.vehicleId === v.vehicle.id &&
      v.options.some((opt) => opt.label === selected.option.label)
    ) {
      return selected.option;
    }

    const activeLabel = activeOptionByVehicle[v.vehicle.id];
    return v.options.find((opt) => opt.label === activeLabel) ?? v.options[0];
  }

  if (!dealId) {
    return (
      <div style={{ padding: 16, color: "#fca5a5" }}>
        Missing dealId in route params. (Check folder name: <code>deals/[dealId]/vehicle</code>)
      </div>
    );
  }

  const nextDisabled = !incomeAppliedOk || !selected || loading;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Step 3: Vehicle</h2>
          {header ? (
            <div
              style={{
                marginTop: 4,
                fontSize: 13,
                color: "rgba(255,255,255,0.62)",
                fontWeight: 600,
              }}
            >
              APR <b style={{ color: "#f5f7fa" }}>{Number(header.apr ?? 0).toFixed(2)}%</b> | Max
              payment <b style={{ color: "#7de2ff" }}>{money(header.max_payment_cap)}</b> | Terms
              capped by mileage and age policy
            </div>
          ) : null}
        </div>

        <div style={{ flex: 1 }} />

        <Button
          type="button"
          variant="outline"
          onClick={onPrev}
          className="border-border/75 bg-background/35 text-foreground hover:bg-accent/80"
        >
          {"<-"} Previous
        </Button>

        <Button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          className="font-semibold"
          title={
            !incomeAppliedOk
              ? "Wait for Step 2 income totals to finish updating"
              : !selected
                ? "Pick an option"
                : ""
          }
        >
          Next {"->"}
        </Button>
      </div>

      {!loading && !incomeAppliedOk ? (
        <div style={{ ...card, border: "1px solid rgba(248,113,113,0.28)", background: "rgba(127,29,29,0.2)" }}>
          <div style={{ fontWeight: 900, color: "#fca5a5" }}>Income totals are not ready yet.</div>
          <div style={{ marginTop: 6, opacity: 0.85 }}>
            Go back to <b>Step 2</b> and let the income step finish saving and updating totals.
            Until then, vehicle options are locked.
          </div>
        </div>
      ) : null}

      {selected ? (
        <div style={{ ...card, background: "rgba(10,18,30,0.3)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900 }}>Selected:</div>
            <div>
              <b>
                {selected.stock} | {selected.year} {selected.make} {selected.model}
              </b>
            </div>
            <div style={{ opacity: 0.75 }}>
              ({selected.option.label}) {money(selected.option.monthly_payment)}/mo |{" "}
              {selected.option.term_months ?? "-"} mo
            </div>

            <div style={{ flex: 1 }} />

            <button type="button" onClick={() => setSelected(null)} style={btnSecondary}>
              Clear
            </button>
          </div>
        </div>
      ) : null}

      <div style={{ ...card, display: "grid", gap: 12 }}>
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

          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.62)" }}>
            {dealInputSaveState === "saving"
              ? "Saving cash down..."
              : dealInputSaveState === "saved"
                ? "Cash down saved"
                : dealInputSaveState === "error"
                  ? "Cash down save failed"
                  : "Cash down autosaves"}
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
                    background: active ? "rgba(70,205,255,0.14)" : "rgba(10,18,30,0.45)",
                    border: `1px solid ${active ? "rgba(70,205,255,0.32)" : "rgba(255,255,255,0.1)"}`,
                    color: active ? "#7de2ff" : "rgba(255,255,255,0.82)",
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

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={miniStat}>
            Results <span style={miniStatValue}>{filtered.length}</span>
          </div>
          <div style={miniStat}>
            Trade Equity{" "}
            <span
              style={{
                ...miniStatValue,
                color:
                  tradeEquityPreview > 0
                    ? "#34d399"
                    : tradeEquityPreview < 0
                      ? "#f87171"
                      : "rgba(255,255,255,0.72)",
              }}
            >
              {money(tradeEquityPreview)}
            </span>
          </div>
          {filtered[0] ? (
            <div style={miniStat}>
              Best Match <span style={miniStatValue}>{filtered[0].vehicle.stock_number ?? "-"}</span>
            </div>
          ) : null}
        </div>
      </div>

      {loading ? <div style={{ opacity: 0.8 }}>Loading...</div> : null}
      {err ? <div style={{ color: "#fca5a5" }}>{err}</div> : null}

      {!loading && !err ? (
        <div style={tableShell}>
          <Table className="min-w-[1180px]">
            <TableHeader>
              <TableRow className="border-border/80 bg-background/55 hover:bg-background/55">
                <TableHead className="w-[360px]">Vehicle</TableHead>
                <TableHead className="w-[170px]">Monthly Payment</TableHead>
                <TableHead className="w-[120px]">Required Down</TableHead>
                <TableHead className="w-[90px]">Term</TableHead>
                <TableHead className="w-[90px]">LTV</TableHead>
                <TableHead className="w-[90px]">PTI</TableHead>
                <TableHead className="w-[250px]">Status</TableHead>
                <TableHead className="w-[110px] text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((v) => {
                const age = daysSince(v.vehicle.date_in_stock);
                const priceError = hasPriceError(v.vehicle);
                const activeOption = getActiveOption(v);
                const isBest = v.vehicle.id === bestVehicleId;
                const isSelected =
                  selected?.vehicleId === v.vehicle.id &&
                  selected.option.label === activeOption.label;
                const statusLabel = priceError ? "No price" : getStatusLabel(activeOption);
                const statusDetail = priceError
                  ? "Vehicle is not priced yet"
                  : getOptionReasonDetail(activeOption);
                const ptiPercent =
                  header?.max_payment_cap && header.max_payment_cap > 0
                    ? (activeOption.monthly_payment / header.max_payment_cap) * 100
                    : null;

                return (
                  <TableRow
                    key={v.vehicle.id}
                    className={cn(
                      "align-top border-border/70",
                      isBest &&
                        "border-l-2 border-l-primary bg-[linear-gradient(90deg,rgba(70,205,255,0.09),rgba(70,205,255,0.02)_32%,rgba(0,0,0,0))] shadow-[inset_0_0_0_1px_rgba(70,205,255,0.18)]",
                      isSelected && "bg-primary/8"
                    )}
                  >
                    <TableCell className="px-4 py-3">
                      <div className="grid gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {isBest ? <Badge className="bg-primary text-primary-foreground">Best Fit</Badge> : null}
                          {isSelected ? <Badge variant="secondary">Selected</Badge> : null}
                          {v.fitsNow && !priceError ? <Badge variant="success">Fits Now</Badge> : null}
                          {v.vehicle.vehicle_category ? (
                            <Badge variant="outline" className="text-[10px]">
                              {v.vehicle.vehicle_category}
                            </Badge>
                          ) : null}
                        </div>

                        <div className="grid gap-1">
                          <div className="text-sm font-black leading-tight text-foreground">
                            {v.vehicle.year ?? "-"} {v.vehicle.make ?? "-"} {v.vehicle.model ?? "-"}
                          </div>
                          <div className="text-xs font-semibold text-muted-foreground">
                            Stock {v.vehicle.stock_number ?? "-"} | Ask {money(v.vehicle.asking_price)} | Mileage{" "}
                            {v.vehicle.odometer != null ? num(v.vehicle.odometer) : "-"} | Age{" "}
                            {age == null ? "-" : `${age}d`}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {v.options.map((opt) => {
                            const active = activeOption.label === opt.label;

                            return (
                              <button
                                key={`${v.vehicle.id}-${opt.label}`}
                                type="button"
                                onClick={() =>
                                  setActiveOptionByVehicle((current) => ({
                                    ...current,
                                    [v.vehicle.id]: opt.label,
                                  }))
                                }
                                className={cn(
                                  "inline-flex min-w-[68px] items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors",
                                  active
                                    ? "border-primary/35 bg-primary/14 text-primary"
                                    : "border-border/70 bg-background/50 text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                                )}
                                title={getOptionHoverText(opt)}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="px-4 py-3">
                      <div className="grid gap-1">
                        <div className="text-[28px] font-black leading-none tracking-[-0.02em] text-foreground">
                          {money(activeOption.monthly_payment)}
                        </div>
                        <div className="text-xs font-semibold text-muted-foreground">
                          {activeOption.label} structure
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="px-4 py-3">
                      <div
                        className={cn(
                          "text-base font-extrabold",
                          (activeOption.additional_down_needed ?? 0) > 0
                            ? "text-amber-300"
                            : "text-foreground"
                        )}
                      >
                        {(activeOption.additional_down_needed ?? 0) > 0
                          ? `+${money(activeOption.additional_down_needed)}`
                          : "$0"}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-muted-foreground">
                        add to current down
                      </div>
                    </TableCell>

                    <TableCell className="px-4 py-3">
                      <div className="text-sm font-bold text-foreground">
                        {activeOption.term_months ?? "-"} mo
                      </div>
                    </TableCell>

                    <TableCell className="px-4 py-3">
                      <div className="text-sm font-bold text-foreground">
                        {activeOption.ltv_est != null ? `${activeOption.ltv_est.toFixed(1)}%` : "-"}
                      </div>
                    </TableCell>

                    <TableCell className="px-4 py-3">
                      <div className="text-sm font-bold text-foreground">
                        {ptiPercent != null && Number.isFinite(ptiPercent) ? `${ptiPercent.toFixed(0)}% cap` : "-"}
                      </div>
                    </TableCell>

                    <TableCell className="px-4 py-3">
                      <div className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              priceError
                                ? "warning"
                                : getOptionBadgeVariant(activeOption)
                            }
                          >
                            {statusLabel}
                          </Badge>
                          {activeOption.include_vsc ? (
                            <span className={productChip(true)}>VSC</span>
                          ) : null}
                          {activeOption.include_gap ? (
                            <span className={productChip(true)}>GAP</span>
                          ) : null}
                          {!activeOption.include_vsc && !activeOption.include_gap ? (
                            <span className={productChip(false)}>No products</span>
                          ) : null}
                        </div>
                        {statusDetail ? (
                          <div className="text-xs font-semibold text-muted-foreground">
                            {statusDetail}
                          </div>
                        ) : activeOption.fits_cap ? (
                          <div className="text-xs font-semibold text-muted-foreground">
                            Meets payment, LTV, amount financed, and price limits
                          </div>
                        ) : null}
                      </div>
                    </TableCell>

                    <TableCell className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        disabled={!incomeAppliedOk || priceError}
                        onClick={() => onPick(v, activeOption)}
                        variant={isSelected ? "default" : "outline"}
                        size="sm"
                        className={cn(
                          "min-w-[88px]",
                          !isSelected &&
                            "border-border/75 bg-background/35 text-foreground hover:bg-accent/80"
                        )}
                        title={
                          !incomeAppliedOk
                            ? "Income totals not ready"
                            : priceError
                              ? "Vehicle is not priced yet"
                              : getOptionHoverText(activeOption)
                        }
                      >
                        {isSelected ? "Chosen" : "Choose"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: 14,
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015))",
  boxShadow: "0 16px 36px rgba(0,0,0,0.2)",
};

const tableShell: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  overflow: "hidden",
  background: "linear-gradient(180deg, rgba(9,16,26,0.92), rgba(7,12,20,0.98))",
  boxShadow: "0 18px 40px rgba(0,0,0,0.28)",
};

const input: React.CSSProperties = {
  width: 140,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(10,18,30,0.6)",
  color: "#f5f7fa",
  outline: "none",
};

const filterBtn: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(10,18,30,0.45)",
  color: "rgba(255,255,255,0.88)",
  cursor: "pointer",
  fontWeight: 800,
  minWidth: 72,
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

const miniStat: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(10,18,30,0.28)",
  fontSize: 12,
  fontWeight: 800,
  color: "rgba(255,255,255,0.62)",
};

const miniStatValue: React.CSSProperties = {
  color: "#f5f7fa",
  fontWeight: 900,
};

function productChip(active: boolean) {
  return cn(
    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
    active
      ? "border-primary/30 bg-primary/10 text-primary"
      : "border-border/70 bg-background/50 text-muted-foreground"
  );
}
