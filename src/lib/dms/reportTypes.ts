export const DMS_REPORT_TYPES = [
  "all_accounts",
  "payment_ledger",
  "bhph_activities",
] as const;

export type DmsReportType = (typeof DMS_REPORT_TYPES)[number];

export type DmsCsvRow = Record<string, string>;

export const REPORT_REQUIRED_HEADERS: Record<DmsReportType, readonly string[]> = {
  all_accounts: ["Deal Number"],
  payment_ledger: ["Deal Identifier", "Paid Date", "Paid Amount", "Transaction Type"],
  bhph_activities: ["Account Number", "Activity Status", "Activity Type", "Created Date"],
};

export const REPORT_JOIN_HEADER: Record<DmsReportType, string> = {
  all_accounts: "Deal Number",
  payment_ledger: "Deal Identifier",
  bhph_activities: "Account Number",
};

export function isDmsReportType(value: unknown): value is DmsReportType {
  return (
    typeof value === "string" &&
    DMS_REPORT_TYPES.includes(value as DmsReportType)
  );
}

export function validateRequiredHeaders(args: {
  reportType: DmsReportType;
  headers: readonly string[];
}) {
  const present = new Set(args.headers);
  const missing = REPORT_REQUIRED_HEADERS[args.reportType].filter(
    (header) => !present.has(header)
  );

  return {
    ok: missing.length === 0,
    missing,
  };
}
