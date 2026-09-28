export type ServiceMonth = {
  month: string;
  billingGroup: string;
  closedOrders: number;
  salesBeforeTax: number;
  tax: number;
  salesWithTax: number;
  labor: number;
  partsAndTires: number;
  sublets: number;
  fees: number;
};

export type DashboardFilters = {
  from: string;
  to: string;
  salesperson: string;
  lender: string;
  inventoryStatus: string;
};

export type Summary = {
  unitsSold: number;
  financeUnits: number;
  cashUnits: number;
  bhphUnits: number;
  wholesaleUnits: number;
  frontGross: number;
  backGross: number;
  totalGross: number;
  averageGross: number;
  vehicleSales: number;
  vehicleCost: number;
  lenderCoverage: number;
  financeLendersUsed: number;
  financeDealsWithScore: number;
  financeAverageCreditScore: number | null;
  financeBackGross: number;
};

export type ImportHealth = {
  report_key: string; canonical_name: string; report_domain: string;
  source_received_at: string | null; completed_at: string | null;
  source_row_count: number | null; loaded_row_count: number | null; rejected_row_count: number | null;
  warning_count: number | null; stored_rows: number | null; normalized_rows: number | null;
  checked_at: string | null; expected_date: string; problems: string[] | null;
  health_status: string;
};
export type SourceIssue = {
  report_key: string; issue_code: string; first_seen_at: string; last_seen_at: string;
  resolved_at: string | null; affected_rows: number; source_row_numbers: number[];
  owner_name: string; review_status: "open" | "in_review"; notes: string;
  updated_by: string | null; updated_at: string | null;
};
export type DashboardData = {
  importHealth: ImportHealth[];
  sourceIssues: SourceIssue[];
  filters: DashboardFilters;
  summary: Summary;
  priorSummary: Summary;
  monthly: Array<{ month: string; units: number; frontGross: number; backGross: number; totalGross: number }>;
  salespeople: Array<{ name: string; units: number; totalGross: number }>;
  lenders: Array<{ name: string; deals: number; amountFinanced: number; totalGross: number; averageCreditScore: number | null }>;
  scoreBands: Array<{ band: string; deals: number; sort: number }>;
  leadSources: Array<{ name: string; soldDeals: number; totalGross: number }>;
  bhphSummary: Array<{ eventType: string; records: number; amount: number; balance: number; latestEventDate: string | null; snapshotAt: string | null }>;
  inventoryAging: Array<{ bucket: string; units: number; totalCost: number; sort: number }>;
  inventory: Array<Record<string, string | number | null>>;
  attention: Array<Record<string, string | number | null>>;
  recentDeals: Array<Record<string, string | number | null>>;
  choices: { salespeople: string[]; lenders: string[]; inventoryStatuses: string[] };
  freshness: { soldDealsUpdatedAt: string | null; inventoryUpdatedAt: string | null; latestDealDate: string | null };
};
