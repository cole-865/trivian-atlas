import { createHash } from "node:crypto";

export type DealOverrideBlockerCode =
  | "LTV"
  | "PTI"
  | "AMOUNT_FINANCED"
  | "VEHICLE_PRICE";

export type DealOverrideStructureSnapshot = {
  vehicleId: string | null;
  cashDown: number | null;
  amountFinanced: number | null;
  monthlyPayment: number | null;
  termMonths: number | null;
  ltv: number | null;
  pti: number | null;
};

function normalizeNullableNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Number(value);
}

function normalizeMoneyToCents(value: number | null | undefined) {
  const normalized = normalizeNullableNumber(value);
  return normalized == null ? null : Math.round(normalized * 100);
}

function normalizeRatioToFixedPrecision(
  value: number | null | undefined,
  precision = 10000
) {
  const normalized = normalizeNullableNumber(value);
  return normalized == null ? null : Math.round(normalized * precision);
}

function stableStringify(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = value[key];
        return acc;
      }, {})
  );
}

export function normalizeDealOverrideStructureSnapshot(
  snapshot: DealOverrideStructureSnapshot
) {
  return {
    amountFinancedCents: normalizeMoneyToCents(snapshot.amountFinanced),
    cashDownCents: normalizeMoneyToCents(snapshot.cashDown),
    ltvFixed: normalizeRatioToFixedPrecision(snapshot.ltv),
    monthlyPaymentCents: normalizeMoneyToCents(snapshot.monthlyPayment),
    ptiFixed: normalizeRatioToFixedPrecision(snapshot.pti),
    termMonths: snapshot.termMonths == null ? null : Number(snapshot.termMonths),
    vehicleId: snapshot.vehicleId?.trim() || null,
  };
}

export function buildDealOverrideFingerprint(
  snapshot: DealOverrideStructureSnapshot
) {
  const normalized = normalizeDealOverrideStructureSnapshot(snapshot);
  const serialized = stableStringify(normalized);

  return createHash("sha256").update(serialized).digest("hex");
}
