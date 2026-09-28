import type { DashboardFilters } from "./types";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}


export function parseDashboardFilters(params: URLSearchParams): DashboardFilters {
  const today = new Date();
  const defaultTo = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(today);
  const defaultFrom = `${defaultTo.slice(0, 8)}01`;
  const from = params.get("from") ?? defaultFrom;
  const to = params.get("to") ?? defaultTo;
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) throw new Error("INVALID_DATE");

  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
  if (!Number.isFinite(spanDays) || isoDate(fromDate) !== from || isoDate(toDate) !== to || spanDays < 0 || spanDays > 3_650) throw new Error("INVALID_RANGE");

  return {
    from,
    to,
    salesperson: (params.get("salesperson") ?? "").slice(0, 160),
    lender: (params.get("lender") ?? "").slice(0, 160),
    inventoryStatus: (params.get("inventoryStatus") ?? "").slice(0, 160),
  };
}
