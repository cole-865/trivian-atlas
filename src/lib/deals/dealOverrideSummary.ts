import type { DealOverrideBlockerCode } from "@/lib/deals/dealOverrideFingerprint";

type OverrideSummarySnapshot = {
  assumptions?: {
    max_amount_financed?: number | null;
    max_ltv?: number | null;
    max_payment_cap?: number | null;
    max_vehicle_price?: number | null;
    tier?: string | null;
  } | null;
  structure?: {
    additional_down_breakdown?: {
      amount_financed?: number | null;
      ltv?: number | null;
      min_down?: number | null;
      pti?: number | null;
    } | null;
    amount_financed?: number | null;
    cash_down_effective?: number | null;
    ltv?: number | null;
    monthly_payment?: number | null;
    sale_price?: number | null;
    term_months?: number | null;
    additional_down_needed?: number | null;
  } | null;
  vehicle?: {
    make?: string | null;
    model?: string | null;
    odometer?: number | null;
    stock_number?: string | null;
    year?: number | null;
  } | null;
};

type OverrideSummaryArgs = {
  blockerCode: DealOverrideBlockerCode;
  customerName: string | null;
  snapshot: OverrideSummarySnapshot | null | undefined;
  userNote: string;
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const numberFormatter = new Intl.NumberFormat("en-US");

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }

  return moneyFormatter.format(Number(value));
}

function formatNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }

  return numberFormatter.format(Number(value));
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${(Number(value) * 100).toFixed(1)}%`;
}

export function formatDealOverrideBlockerLabel(
  blockerCode: DealOverrideBlockerCode
) {
  switch (blockerCode) {
    case "PTI":
      return "Payment too high";
    case "LTV":
      return "LTV too high";
    case "AMOUNT_FINANCED":
      return "Amount financed too high";
    case "VEHICLE_PRICE":
      return "Vehicle price too high";
    default:
      return blockerCode;
  }
}

export function getDealOverrideRouteToFixAmount(args: {
  blockerCode: DealOverrideBlockerCode;
  snapshot: OverrideSummarySnapshot | null | undefined;
}) {
  const breakdown = args.snapshot?.structure?.additional_down_breakdown;

  if (args.blockerCode === "AMOUNT_FINANCED") {
    return breakdown?.amount_financed ?? null;
  }

  if (args.blockerCode === "LTV") {
    return breakdown?.ltv ?? null;
  }

  if (args.blockerCode === "PTI") {
    return breakdown?.pti ?? null;
  }

  if (args.blockerCode === "VEHICLE_PRICE") {
    const salePrice = args.snapshot?.structure?.sale_price;
    const maxVehiclePrice = args.snapshot?.assumptions?.max_vehicle_price;
    if (
      salePrice != null &&
      Number.isFinite(salePrice) &&
      maxVehiclePrice != null &&
      Number.isFinite(maxVehiclePrice)
    ) {
      return Math.max(0, Number(salePrice) - Number(maxVehiclePrice));
    }
  }

  return breakdown?.min_down ?? null;
}

export function buildDealOverrideRequestLines(args: {
  blockerCode: DealOverrideBlockerCode;
  customerName: string | null;
  snapshot: OverrideSummarySnapshot | null | undefined;
}) {
  const vehicle = args.snapshot?.vehicle;
  const assumptions = args.snapshot?.assumptions;
  const structure = args.snapshot?.structure;
  const vehicleLabel =
    [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") ||
    "n/a";

  return [
    `Stk Number: ${vehicle?.stock_number?.trim() || "n/a"}`,
    `Customer Name: ${args.customerName?.trim() || "n/a"}`,
    `Vehicle: ${vehicleLabel}`,
    `Odo: ${formatNumber(vehicle?.odometer)}`,
    `Tier: ${assumptions?.tier?.trim() || "n/a"}`,
    `Blocking Issue: ${formatDealOverrideBlockerLabel(args.blockerCode)}`,
    `Vehicle Price: ${formatMoney(structure?.sale_price)}${
      assumptions?.max_vehicle_price != null
        ? ` vs ${formatMoney(assumptions.max_vehicle_price)} max`
        : ""
    }`,
    `Amount Financed: ${formatMoney(structure?.amount_financed)}${
      assumptions?.max_amount_financed != null
        ? ` vs ${formatMoney(assumptions.max_amount_financed)} max`
        : ""
    }`,
    `Monthly Payment: ${formatMoney(structure?.monthly_payment)}${
      assumptions?.max_payment_cap != null
        ? ` vs ${formatMoney(assumptions.max_payment_cap)} cap`
        : ""
    }`,
    `Cash Down Used: ${formatMoney(structure?.cash_down_effective)}`,
    `Additional Down Needed: ${formatMoney(structure?.additional_down_needed)}`,
    `LTV: ${formatPercent(structure?.ltv)}${
      assumptions?.max_ltv != null
        ? ` vs ${formatPercent(assumptions.max_ltv)} max`
        : ""
    }`,
    `Route to Fix Issue: ${formatMoney(getDealOverrideRouteToFixAmount(args))}`,
    `Term: ${
      structure?.term_months != null && Number.isFinite(structure.term_months)
        ? `${Number(structure.term_months)} months`
        : "n/a"
    }`,
  ];
}

export function buildDealOverrideRequestNote(args: OverrideSummaryArgs) {
  return [
    ...buildDealOverrideRequestLines(args),
    "",
    "Reason for Exception:",
    args.userNote.trim(),
  ].join("\n");
}
