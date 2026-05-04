const DATE_ONLY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const TIMESTAMP_RE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i;

export function blankToNull(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

export function normalizeIdentifier(value: unknown): string | null {
  return blankToNull(value);
}

export function parseDmsNumeric(value: unknown): number | null {
  const original = String(value ?? "").trim();
  if (!original) return null;
  if (["n/a", "na", "unknown", "null", "none"].includes(original.toLowerCase())) {
    return null;
  }

  const cleaned = original.replace(/[$,()%\s]/g, "");
  if (["", "--", "-", ".", "-.", "+", "+."].includes(cleaned)) return null;
  if (!/^[+-]?((\d+(\.\d*)?)|(\.\d+))$/.test(cleaned)) return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;

  return /^\(.*\)$/.test(original) ? -parsed : parsed;
}

export function parseDmsInteger(value: unknown): number | null {
  const parsed = parseDmsNumeric(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function parseDmsDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const match = raw.match(DATE_ONLY_RE);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseDmsTimestamp(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const match = raw.match(TIMESTAMP_RE);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  let hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const meridiem = match[7]?.toUpperCase();

  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
}

export function parseDmsBoolean(value: unknown): boolean | null {
  switch (String(value ?? "").trim().toLowerCase()) {
    case "true":
    case "yes":
    case "y":
    case "1":
      return true;
    case "false":
    case "no":
    case "n":
    case "0":
      return false;
    default:
      return null;
  }
}

export function paymentFrequencyDays(value: unknown): number | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("semi") && normalized.includes("month")) return 15;
  if (normalized.includes("semimonth")) return 15;
  if (normalized.includes("bi") && normalized.includes("week")) return 14;
  if (normalized.includes("every 2 week")) return 14;
  if (normalized.includes("weekly")) return 7;
  if (normalized.includes("month")) return 30;
  return null;
}

export function isReversalLike(args: {
  paidAmount: number | null;
  transactionType: string | null;
  isAchReturned: boolean | null;
  isAutoNsf: boolean | null;
}) {
  const transactionType = args.transactionType?.toLowerCase() ?? "";
  return (
    args.isAchReturned === true ||
    args.isAutoNsf === true ||
    (args.paidAmount ?? 0) < 0 ||
    /revers|return|nsf|void|chargeback/.test(transactionType)
  );
}
