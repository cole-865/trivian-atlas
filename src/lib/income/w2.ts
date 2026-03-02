// src/lib/income/w2.ts
export type PayFrequency =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "annually";

const periodsPerYear: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  annually: 1,
};

export function safeDate(input?: string | null): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function clampMoney(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function parseMoney(input: string): number {
  // Accepts "$1,234.56" / "1234.56" / "" safely
  const cleaned = (input ?? "").replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return clampMoney(Number.isFinite(n) ? n : 0);
}

/**
 * Returns tenure in years + months (whole months).
 * Uses calendar months, and "borrows" a month if end day < start day.
 */
export function calcTenureYM(start: Date, end: Date): { years: number; months: number } {
  if (end.getTime() < start.getTime()) return { years: 0, months: 0 };

  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();

  // Adjust months based on day-of-month
  if (end.getDate() < start.getDate()) months -= 1;

  const totalMonths = years * 12 + months;
  const safeTotalMonths = Math.max(0, totalMonths);

  return {
    years: Math.floor(safeTotalMonths / 12),
    months: safeTotalMonths % 12,
  };
}

export function formatTenure(ym: { years: number; months: number }): string {
  const y = ym.years;
  const m = ym.months;
  const yPart = y === 1 ? "1 year" : `${y} years`;
  const mPart = m === 1 ? "1 month" : `${m} months`;
  if (y === 0) return mPart;
  if (m === 0) return yPart;
  return `${yPart}, ${mPart}`;
}

/**
 * Calculates the YTD window start:
 * - Jan 1 of pay period end year
 * - OR hireDate if hireDate is later than Jan 1
 */
export function getYtdStart(hireDate: Date, payPeriodEnd: Date): Date {
  const jan1 = new Date(payPeriodEnd.getFullYear(), 0, 1);
  return hireDate.getTime() > jan1.getTime() ? hireDate : jan1;
}

/**
 * Whole months count for YTD averaging:
 * - counts partial first month as 1 (so new hires don't explode the monthly)
 * - e.g., hire Feb 20, pay end Mar 05 => monthsWorked=2 (Feb + Mar)
 */
export function countWorkedMonthsInclusive(start: Date, end: Date): number {
  if (end.getTime() < start.getTime()) return 0;
  const startKey = start.getFullYear() * 12 + start.getMonth();
  const endKey = end.getFullYear() * 12 + end.getMonth();
  return Math.max(1, endKey - startKey + 1);
}

export function calcMonthlyFromPaycheck(grossThisPeriod: number, frequency: PayFrequency): number {
  const ppy = periodsPerYear[frequency] ?? 0;
  if (ppy <= 0) return 0;
  return clampMoney((grossThisPeriod * ppy) / 12);
}

export function calcMonthlyFromYtd(ytdGross: number, ytdStart: Date, payPeriodEnd: Date): number {
  const months = countWorkedMonthsInclusive(ytdStart, payPeriodEnd);
  if (months <= 0) return 0;
  return clampMoney(ytdGross / months);
}

export function calcW2Income(params: {
  hireDate: Date;
  payPeriodEnd: Date;
  payFrequency: PayFrequency;
  grossThisPeriod: number;
  ytdGross?: number;
}) {
  const { hireDate, payPeriodEnd, payFrequency, grossThisPeriod, ytdGross } = params;

  const tenure = calcTenureYM(hireDate, payPeriodEnd);
  const ytdStart = getYtdStart(hireDate, payPeriodEnd);

  const monthlyFromPaycheck = calcMonthlyFromPaycheck(grossThisPeriod, payFrequency);

  const monthlyFromYtd =
    typeof ytdGross === "number" && ytdGross > 0
      ? calcMonthlyFromYtd(ytdGross, ytdStart, payPeriodEnd)
      : 0;

  return {
    tenure,
    tenureLabel: formatTenure(tenure),
    ytdStart,
    ytdStartISO: ytdStart.toISOString().slice(0, 10),
    monthlyFromPaycheck,
    monthlyFromYtd,
  };
}