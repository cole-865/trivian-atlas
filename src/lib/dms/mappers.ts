import {
  activityEventHash,
  transactionHash,
} from "./hashes";
import {
  blankToNull,
  isReversalLike,
  normalizeIdentifier,
  parseDmsBoolean,
  parseDmsDate,
  parseDmsInteger,
  parseDmsNumeric,
  parseDmsTimestamp,
} from "./normalizers";
import type { DmsCsvRow, DmsReportType } from "./reportTypes";

type BaseMapArgs = {
  organizationId: string;
  importBatchId: string;
  row: DmsCsvRow;
  ledgerOccurrenceIndex?: number;
};

function text(row: DmsCsvRow, header: string) {
  return blankToNull(row[header]);
}

function idText(row: DmsCsvRow, header: string) {
  return normalizeIdentifier(row[header]);
}

function money(row: DmsCsvRow, header: string) {
  return parseDmsNumeric(row[header]);
}

function int(row: DmsCsvRow, header: string) {
  return parseDmsInteger(row[header]);
}

function date(row: DmsCsvRow, header: string) {
  return parseDmsDate(row[header]);
}

function timestamp(row: DmsCsvRow, header: string) {
  return parseDmsTimestamp(row[header]);
}

function bool(row: DmsCsvRow, header: string) {
  return parseDmsBoolean(row[header]);
}

export function mapAllAccountsRow(args: BaseMapArgs) {
  const { organizationId, importBatchId, row } = args;
  const dealNumber = idText(row, "Deal Number");
  if (!dealNumber) return null;

  return {
    organization_id: organizationId,
    import_batch_id: importBatchId,
    deal_number: dealNumber,
    lender_name: text(row, "Lender Name"),
    lender_type: text(row, "Lender Type"),
    account_status: text(row, "Account Status"),
    account_closed_date: date(row, "Account Closed Date"),
    charge_off_date: date(row, "Charge Off Date"),
    charge_off_reason: text(row, "Charge Off Reason"),
    bad_debt_amount: money(row, "Bad Debt Amount"),
    principal_bad_debt_amount: money(row, "Principal Bad Debt Amount"),
    deal_date: date(row, "Deal Date"),
    first_payment_date: date(row, "First Payment Date"),
    original_due_date: date(row, "Original Due Date"),
    new_due_date: date(row, "New Due Date"),
    payment_end_date: date(row, "Payment End Date"),
    payment_frequency: text(row, "Payment Frequency"),
    apr: money(row, "APR"),
    original_financed_amount: money(row, "Original Financed Amount"),
    original_financed_charge: money(row, "Original Financed Charge"),
    total_payment_amount: money(row, "Total Payment Amount"),
    remaining_payment: money(row, "Remaining Payment"),
    final_payment_amount: money(row, "Final Payment Amount"),
    previous_payment_amount: money(row, "Previous Payment Amount"),
    payment_status: text(row, "Payment Status"),
    auto_pay_status: text(row, "Auto Pay Status"),
    days_past_due: int(row, "Days Past Due"),
    total_past_due_amount: money(row, "Total Past Due Amount"),
    total_payment_due_amount: money(row, "Total Payment Due Amount"),
    principal_due_amount: money(row, "Principal Due Amount"),
    interest_due_amount: money(row, "Interest Due Amount"),
    late_due_amount: money(row, "Late Due Amount"),
    other_due_amount: money(row, "Other Due Amount"),
    side_note_due_amount: money(row, "Side Note Due Amount"),
    down_due_amount: money(row, "Down Due Amount"),
    credit_due_amount: money(row, "Credit Due Amount"),
    last_paid_date: date(row, "Last Paid Date"),
    last_paid_amount: money(row, "Last Paid Amount"),
    balance_principal_amount: money(row, "Balance Principal Amount"),
    interest_balance_amount: money(row, "Interest Balance"),
    late_balance_amount: money(row, "Late Balance"),
    other_balance_amount: money(row, "Other Balance"),
    balance_side_note_amount: money(row, "Balance Side Note Amount"),
    balance_down_amount: money(row, "Balance Down Amount"),
    tax_balance_amount: money(row, "Tax Balance"),
    total_payoff_amount: money(row, "Total Payoff Amount"),
    total_paid_amount: money(row, "Total Paid Amount"),
    total_paid_without_down_side_note: money(row, "Total Paid Without Down Side Note"),
    principal_paid_amount: money(row, "Principal Paid Amount"),
    interest_paid_amount: money(row, "Interest Paid Amount"),
    total_late_fees_paid_amount: money(row, "Total Late Fees Paid Amount"),
    total_other_fees_paid_amount: money(row, "Total Other Fees Paid Amount"),
    total_side_note_paid_amount: money(row, "Total Side Note Paid Amount"),
    total_down_paid_amount: money(row, "Total Down Paid Amount"),
    collector_name: text(row, "Collector Name"),
    last_contacted_date: date(row, "Last Contacted Date"),
    next_call_back_date: date(row, "Next Call Back Date"),
    promise_amount: money(row, "Promise Amount"),
    promise_created_date: date(row, "Promise Created Date"),
    promise_date: date(row, "Promise Date"),
    promise_note: text(row, "Promise Note"),
    promised_result: text(row, "Promised Result"),
    notes: text(row, "Notes"),
    num_of_extensions: int(row, "Num Of Extensions"),
    num_of_loan_modification: int(row, "Num Of Loan Modification"),
    loan_modification_date: date(row, "Loan Modification Date"),
    loan_modification_reason: text(row, "Loan Modification Reason"),
    collateral_status: text(row, "Collateral Status"),
    repo_status: text(row, "Repo Status"),
    repo_stage: text(row, "Repo Stage"),
    repo_type: text(row, "Repo Type"),
    repo_reason: text(row, "Repo Reason"),
    out_for_repo_date: date(row, "Out For Repo Date"),
    repo_created_date: date(row, "Repo Created Date"),
    repo_completed_date: date(row, "Repo Completed Date"),
    last_repo_date: date(row, "Last Repo Date"),
    cured_date: date(row, "CuredDate"),
    repo_company_name: text(row, "Repo Company Name"),
    repo_fees: money(row, "Repo Fees"),
    repo_location: text(row, "Repo Location"),
    recovery_amount: money(row, "Recovery Amount"),
    recovery_without_repo_credit: money(row, "Recovery Without Repo Credit"),
    repo_credit: money(row, "Repo Credit"),
    account_sell_date: date(row, "Account Sell Date"),
    account_sale_received_amount: money(row, "Account Sale Received Amount"),
    buy_back_date: date(row, "Buy Back Date"),
    buy_back_cost: money(row, "Buy Back Cost"),
    buy_back_reason: text(row, "Buy Back Reason"),
    vehicle_year_make_model: text(row, "Vehicle Year Make Model"),
    vehicle_vin: idText(row, "Vehicle VIN"),
    vin_last_six: idText(row, "VIN Last Six"),
    vehicle_stock_number: idText(row, "Vehicle Stock Number"),
    vehicle_mileage: int(row, "Vehicle Mileage"),
    vehicle_price: money(row, "Vehicle Price"),
    vehicle_cost: money(row, "Vehicle Cost"),
    vehicle_exterior_color: text(row, "Vehicle Exterior Color"),
    vehicle_fuel_type: text(row, "Vehicle Fuel Type"),
    gps_provider: text(row, "GPS Provider"),
    gps_tracking_number: idText(row, "GPS Tracking Number"),
    current_insurance_carrier: text(row, "Current Insurance Carrier"),
    current_insurance_effective_date: date(row, "Current Insurance Effective Date"),
    current_insurance_expiry_date: date(row, "Current Insurance Expiry Date"),
    insurance_status: text(row, "Insurance Status"),
    down_amount: money(row, "Down"),
    total_down_amount: money(row, "Total Down"),
    total_cash_in_deal: money(row, "Total Cash In Deal"),
    net_cash_in_deal: money(row, "Net Cash In Deal"),
    total_price: money(row, "Total Price"),
    total_gross: money(row, "Total Gross"),
    front_gross_amount: money(row, "Front Gross Amount"),
    backend_gross_amount: money(row, "Backend Gross Amount"),
    dealer_gross_amount: money(row, "Dealer Gross Amount"),
    net_profit: money(row, "Net Profit"),
    exposure: money(row, "Exposure"),
    num_of_payments_till_break_even: int(row, "Num Of Payments Till Break Even"),
    custom_account_status: text(row, "Custom Account Status"),
    account_conditions: text(row, "Account Conditions"),
    raw_data: row,
  };
}

export function mapPaymentLedgerRow(args: BaseMapArgs) {
  const { organizationId, importBatchId, row } = args;
  const dealNumber = idText(row, "Deal Identifier");
  if (!dealNumber) return null;

  const paidAmount = money(row, "Paid Amount");
  const transactionType = text(row, "Transaction Type");
  const isAchReturned = bool(row, "Is ACH Returned");
  const isAutoNsf = bool(row, "Is Auto NSF");
  const isReversal = isReversalLike({
    paidAmount,
    transactionType,
    isAchReturned,
    isAutoNsf,
  });

  return {
    organization_id: organizationId,
    import_batch_id: importBatchId,
    transaction_hash: transactionHash(row, args.ledgerOccurrenceIndex ?? 1),
    deal_number: dealNumber,
    paid_date: date(row, "Paid Date"),
    paid_amount: paidAmount,
    transaction_type: transactionType,
    late_fee_amount: money(row, "Late Fee Amount"),
    period_num: idText(row, "Period Number"),
    ref_num: idText(row, "Reference Number"),
    last_updated_by_name: text(row, "Last Updated By Name"),
    last_updated_date: timestamp(row, "Last Updated Date"),
    is_ach_returned: isAchReturned,
    is_auto_nsf: isAutoNsf,
    account_conditions: text(row, "Account Conditions"),
    days_late: int(row, "Days Late"),
    balance_amount: money(row, "Balance Amount"),
    collector_name: text(row, "Collector Name"),
    deal_status: text(row, "Deal Status"),
    late_fees_applied_amt: money(row, "Late Fees Applied Amount"),
    other_fees_applied_amt: money(row, "Other Fees Applied Amount"),
    interest_applied_amt: money(row, "Interest Applied Amount"),
    principal_applied_amt: money(row, "Principal Applied Amount"),
    credit_applied_amt: money(row, "Credit Applied Amount"),
    side_note_applied_amt: money(row, "Side Note Applied Amount"),
    down_applied_amt: money(row, "Down Applied Amount"),
    due_amount: money(row, "Due Amount"),
    account_status: text(row, "Account Status"),
    other_fees_due_amount: money(row, "Other Fees Due Amount"),
    interest_due_amount: money(row, "Interest Due Amount"),
    principal_due_amount: money(row, "Principal Due Amount"),
    side_note_due_amount: money(row, "Side Note Due Amount"),
    processing_fee_due_amount: money(row, "Processing Fee Due Amount"),
    is_reversal: isReversal,
    positive_payment_amount: !isReversal && (paidAmount ?? 0) > 0 ? paidAmount : null,
    reversal_amount: isReversal ? Math.abs(paidAmount ?? 0) : null,
    raw_data: row,
  };
}

export function mapActivityEventRow(args: BaseMapArgs) {
  const { organizationId, importBatchId, row } = args;
  const dealNumber = idText(row, "Account Number");
  if (!dealNumber) return null;

  const activityText = [
    row["Activity Type"],
    row["Disposition"],
    row["Subject"],
  ].join(" ").toLowerCase();
  const promisedResult = text(row, "Promised Result")?.toLowerCase() ?? "";
  const promiseAmount = money(row, "Promise Amount");
  const promiseDate = date(row, "Promise Date");

  return {
    organization_id: organizationId,
    import_batch_id: importBatchId,
    event_hash: activityEventHash(row),
    deal_number: dealNumber,
    customer_name: text(row, "Customer Name"),
    activity_status: text(row, "Activity Status"),
    activity_type: text(row, "Activity Type"),
    disposition: text(row, "Disposition"),
    subject: text(row, "Subject"),
    assigned_rep_on_activity: text(row, "Assigned Rep On Activity"),
    collector: text(row, "Collector"),
    account_status: text(row, "Account Status"),
    created_date: timestamp(row, "Created Date"),
    last_updated_date: timestamp(row, "Last Updated Date"),
    last_updated_by: text(row, "Last Updated By"),
    promise_amount: promiseAmount,
    promise_date: promiseDate,
    promised_result: text(row, "Promised Result"),
    payment_due_date: date(row, "Payment Due Date"),
    is_sms: /sms|text/.test(activityText),
    is_email: /email|e-mail/.test(activityText),
    is_call: /call|phone|voicemail|vm/.test(activityText),
    is_inbound: /inbound|incoming|customer called|reply|responded/.test(activityText),
    is_outbound: /outbound|called customer|sms sent|text sent|email sent/.test(activityText),
    has_promise: promiseAmount != null || promiseDate != null || promisedResult.length > 0,
    promise_kept: /kept|paid|complete|honor/.test(promisedResult),
    promise_broken: /broken|miss|failed|not kept/.test(promisedResult),
    raw_data: row,
  };
}

export function mapDmsRow(args: BaseMapArgs & { reportType: DmsReportType }) {
  if (args.reportType === "all_accounts") return mapAllAccountsRow(args);
  if (args.reportType === "payment_ledger") return mapPaymentLedgerRow(args);
  return mapActivityEventRow(args);
}
