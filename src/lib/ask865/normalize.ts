import type { DashboardData, DashboardFilters, Summary, ServiceMonth } from "./types";
const number = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function mapSummary(row: Record<string, unknown>): Summary {
  const finance = number(row.finance_units);
  const financeWithLender = number(row.finance_with_lender);
  return {
    unitsSold: number(row.units_sold),
    financeUnits: finance,
    cashUnits: number(row.cash_units),
    bhphUnits: number(row.bhph_units),
    wholesaleUnits: number(row.wholesale_units),
    frontGross: number(row.front_gross),
    backGross: number(row.back_gross),
    totalGross: number(row.total_gross),
    averageGross: number(row.average_gross),
    vehicleSales: number(row.vehicle_sales),
    vehicleCost: number(row.vehicle_cost),
    lenderCoverage: finance ? (financeWithLender / finance) * 100 : 100,
    financeLendersUsed: number(row.finance_lenders_used),
    financeDealsWithScore: number(row.finance_deals_with_score),
    financeAverageCreditScore: nullableNumber(row.finance_average_credit_score),
    financeBackGross: number(row.finance_back_gross),
  };
}


export type RawRow = Record<string, string | number | null>;
export function normalizeDashboard(raw: Record<string,RawRow[]>,filters:DashboardFilters):DashboardData & {service:ServiceMonth[]} {
 const currentSummary=mapSummary(raw.summary[0]);
 const priorSummary=mapSummary(raw.priorSummary[0]);
  const choices = { salespeople: [] as string[], lenders: [] as string[], inventoryStatuses: [] as string[] };
  for (const row of raw.choices) {
    if (row.kind === "salesperson") choices.salespeople.push(String(row.value));
    if (row.kind === "lender") choices.lenders.push(String(row.value));
    if (row.kind === "inventory_status") choices.inventoryStatuses.push(String(row.value));
  }

  const normalizedInventory = raw.inventory.map((row) => ({
    ...row,
    days_in_inventory: nullableNumber(row.days_in_inventory),
    days_available_for_sale: nullableNumber(row.days_available_for_sale),
    days_from_purchase_to_sale_ready: nullableNumber(row.days_from_purchase_to_sale_ready),
    asking_price: nullableNumber(row.asking_price),
    advertising_price: nullableNumber(row.advertising_price),
    total_cost: nullableNumber(row.total_cost),
    potential_gross: nullableNumber(row.potential_gross),
    days_in_recon: nullableNumber(row.days_in_recon),
    amount_floored: nullableNumber(row.amount_floored),
  }));

  const normalizedDeals = raw.deals.map((row) => ({
    ...row,
    days_old: nullableNumber(row.days_old),
    total_recon: nullableNumber(row.total_recon),
    credit_score: nullableNumber(row.credit_score),
    vehicle_price: nullableNumber(row.vehicle_price),
    total_vehicle_cost: nullableNumber(row.total_vehicle_cost),
    front_gross: nullableNumber(row.front_gross),
    back_gross: nullableNumber(row.back_gross),
    total_gross: nullableNumber(row.total_gross),
    financed_amount: nullableNumber(row.financed_amount),
  }));

  const freshness = raw.freshness[0];
  return {
    service: raw.service.map(row => ({month:String(row.month),billingGroup:String(row.billing_group),closedOrders:number(row.closed_orders),salesBeforeTax:number(row.sales_before_tax),tax:number(row.tax),salesWithTax:number(row.sales_with_tax),labor:number(row.labor_after_discount),partsAndTires:number(row.parts_and_tires_after_discount),sublets:number(row.sublets),fees:number(row.fees)})),
    filters,
    importHealth: raw.importHealth as unknown as DashboardData["importHealth"],
    sourceIssues: raw.sourceIssues as unknown as DashboardData["sourceIssues"],
    summary: currentSummary,
    priorSummary,
    monthly: raw.monthly.map((row) => ({ month: String(row.month), units: number(row.units), frontGross: number(row.front_gross), backGross: number(row.back_gross), totalGross: number(row.total_gross) })),
    salespeople: raw.salespeople.map((row) => ({ name: String(row.name), units: number(row.units), totalGross: number(row.total_gross) })),
    lenders: raw.lenders.map((row) => ({ name: String(row.name), deals: number(row.deals), amountFinanced: number(row.amount_financed), totalGross: number(row.total_gross), averageCreditScore: nullableNumber(row.average_credit_score) })),
    scoreBands: raw.scoreBands.map((row) => ({ band: String(row.band), deals: number(row.deals), sort: number(row.sort) })),
    leadSources: raw.leadSources.map((row) => ({ name: String(row.name), soldDeals: number(row.sold_deals), totalGross: number(row.total_gross) })),
    bhphSummary: raw.bhph.map((row) => ({
      eventType: String(row.event_type),
      records: number(row.records),
      amount: number(row.amount),
      balance: number(row.balance),
      latestEventDate: row.latest_event_date == null ? null : String(row.latest_event_date),
      snapshotAt: row.snapshot_at == null ? null : String(row.snapshot_at),
    })),
    inventoryAging: raw.aging.map((row) => ({ bucket: String(row.bucket), units: number(row.units), totalCost: number(row.total_cost), sort: number(row.sort) })),
    inventory: normalizedInventory,
    attention: raw.attention.map((row) => ({ ...row, priority_rank: number(row.priority_rank), amount: nullableNumber(row.amount) })),
    recentDeals: normalizedDeals,
    choices,
    freshness: {
      soldDealsUpdatedAt: freshness.sold_updated_at == null ? null : String(freshness.sold_updated_at),
      inventoryUpdatedAt: freshness.inventory_updated_at == null ? null : String(freshness.inventory_updated_at),
      latestDealDate: freshness.latest_deal_date == null ? null : String(freshness.latest_deal_date),
    },
  };
}
