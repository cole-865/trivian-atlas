import test from "node:test";
import assert from "node:assert/strict";
import { parseDmsCsv } from "../src/lib/dms/csv.js";
import {
  activityEventHash,
  transactionHash,
} from "../src/lib/dms/hashes.js";
import { importDmsCsv } from "../src/lib/dms/importService.js";
import {
  mapActivityEventRow,
  mapAllAccountsRow,
  mapPaymentLedgerRow,
} from "../src/lib/dms/mappers.js";
import {
  parseDmsBoolean,
  parseDmsDate,
  parseDmsNumeric,
  parseDmsTimestamp,
  paymentFrequencyDays,
} from "../src/lib/dms/normalizers.js";
import { validateRequiredHeaders } from "../src/lib/dms/reportTypes.js";

test("DMS money parsing handles common accounting and dirty values", () => {
  assert.equal(parseDmsNumeric("$1,234.56"), 1234.56);
  assert.equal(parseDmsNumeric("($1,234.56)"), -1234.56);
  assert.equal(parseDmsNumeric("26.99%"), 26.99);
  assert.equal(parseDmsNumeric(""), null);
  assert.equal(parseDmsNumeric("N/A"), null);
  assert.equal(parseDmsNumeric("--"), null);
  assert.equal(parseDmsNumeric("unknown"), null);
  assert.equal(parseDmsNumeric("not money"), null);
});

test("DMS date parsing handles report dates and timestamp-style dates", () => {
  assert.equal(parseDmsDate("05/04/2026"), "2026-05-04");
  assert.equal(parseDmsDate("05/04/2026 11:22:33 AM"), "2026-05-04");
  assert.equal(parseDmsDate(""), null);
  assert.equal(parseDmsDate("not a date"), null);
  assert.equal(parseDmsTimestamp("05/04/2026 11:22:33 PM"), "2026-05-04T23:22:33.000Z");
});

test("DMS boolean parsing handles expected report values", () => {
  assert.equal(parseDmsBoolean("TRUE"), true);
  assert.equal(parseDmsBoolean("YES"), true);
  assert.equal(parseDmsBoolean("Y"), true);
  assert.equal(parseDmsBoolean("1"), true);
  assert.equal(parseDmsBoolean("FALSE"), false);
  assert.equal(parseDmsBoolean("NO"), false);
  assert.equal(parseDmsBoolean("N"), false);
  assert.equal(parseDmsBoolean("0"), false);
  assert.equal(parseDmsBoolean(""), null);
});

test("DMS payment frequency maps report wording to days", () => {
  assert.equal(paymentFrequencyDays("Weekly"), 7);
  assert.equal(paymentFrequencyDays("Biweekly"), 14);
  assert.equal(paymentFrequencyDays("Bi-weekly"), 14);
  assert.equal(paymentFrequencyDays("Every 2 Weeks"), 14);
  assert.equal(paymentFrequencyDays("Semi-monthly"), 15);
  assert.equal(paymentFrequencyDays("Semimonthly"), 15);
  assert.equal(paymentFrequencyDays("Monthly"), 30);
  assert.equal(paymentFrequencyDays("whenever"), null);
});

test("DMS transaction hash is stable under whitespace and case normalization", () => {
  const base = {
    "Deal Identifier": " 12345 ",
    "Paid Date": "05/04/2026",
    "Paid Amount": "$100.00",
    "Transaction Type": "Payment",
    "Reference Number": " ABC ",
    "Last Updated Date": "05/04/2026 01:00:00 PM",
    "Period Number": " 3 ",
  };
  const equivalent = {
    ...base,
    "Deal Identifier": "12345",
    "Transaction Type": " payment ",
    "Reference Number": "abc",
  };
  const different = { ...base, "Reference Number": "different" };

  assert.equal(transactionHash(base), transactionHash(equivalent));
  assert.notEqual(transactionHash(base), transactionHash(different));
});

test("DMS activity event hash is stable and changes when event identity changes", () => {
  const base = {
    "Account Number": " 12345 ",
    "Customer Name": "Synthetic Customer",
    "Created Date": "05/04/2026 09:00:00 AM",
    "Activity Type": "Call",
    "Activity Status": "Open",
    "Disposition": "Left Message",
    "Subject": "Follow up",
    "Last Updated Date": "05/04/2026 09:05:00 AM",
  };
  const equivalent = { ...base, "Activity Type": " call ", "Account Number": "12345" };
  const different = { ...base, "Subject": "Different" };

  assert.equal(activityEventHash(base), activityEventHash(equivalent));
  assert.notEqual(activityEventHash(base), activityEventHash(different));
});

test("DMS required header validation identifies missing join keys", () => {
  assert.deepEqual(
    validateRequiredHeaders({
      reportType: "all_accounts",
      headers: ["Deal Number", "Account Status"],
    }),
    { ok: true, missing: [] }
  );
  assert.deepEqual(
    validateRequiredHeaders({
      reportType: "payment_ledger",
      headers: ["Paid Date", "Paid Amount", "Transaction Type"],
    }),
    { ok: false, missing: ["Deal Identifier"] }
  );
});

test("DMS All Accounts sample row maps to normalized account snapshot fields", () => {
  const mapped = mapAllAccountsRow({
    organizationId: "org-1",
    importBatchId: "batch-1",
    row: {
      "Deal Number": "A-100",
      "Deal Date": "05/01/2026",
      "Payment Frequency": "Weekly",
      "Total Payment Amount": "$125.50",
      "Days Past Due": "12",
      "Vehicle VIN": "VIN123",
      "Vehicle Stock Number": "STK-1",
      "Net Profit": "($50.00)",
      "Account Status": "Active",
    },
  });

  assert.equal(mapped?.deal_number, "A-100");
  assert.equal(mapped?.deal_date, "2026-05-01");
  assert.equal(mapped?.total_payment_amount, 125.5);
  assert.equal(mapped?.days_past_due, 12);
  assert.equal(mapped?.vehicle_vin, "VIN123");
  assert.equal(mapped?.vehicle_stock_number, "STK-1");
  assert.equal(mapped?.net_profit, -50);
  assert.ok(mapped?.raw_data);
});

test("DMS Payment Ledger sample row maps payment and reversal fields", () => {
  const payment = mapPaymentLedgerRow({
    organizationId: "org-1",
    importBatchId: "batch-1",
    row: {
      "Deal Identifier": "A-100",
      "Paid Date": "05/04/2026",
      "Paid Amount": "$100.00",
      "Transaction Type": "Payment",
      "Reference Number": "REF-1",
      "Last Updated Date": "05/04/2026 01:00:00 PM",
      "Period Number": "2",
    },
  });
  assert.equal(payment?.deal_number, "A-100");
  assert.equal(payment?.positive_payment_amount, 100);
  assert.equal(payment?.reversal_amount, null);
  assert.equal(payment?.is_reversal, false);

  const reversal = mapPaymentLedgerRow({
    organizationId: "org-1",
    importBatchId: "batch-1",
    row: {
      "Deal Identifier": "A-100",
      "Paid Date": "05/04/2026",
      "Paid Amount": "($25.00)",
      "Transaction Type": "NSF Return",
    },
  });
  assert.equal(reversal?.positive_payment_amount, null);
  assert.equal(reversal?.reversal_amount, 25);
  assert.equal(reversal?.is_reversal, true);
});

test("DMS BHPH Activities sample row maps event flags", () => {
  const mapped = mapActivityEventRow({
    organizationId: "org-1",
    importBatchId: "batch-1",
    row: {
      "Account Number": "A-100",
      "Customer Name": "Synthetic Customer",
      "Activity Status": "Done",
      "Activity Type": "Outbound Call",
      "Disposition": "Promise",
      "Subject": "Text sent and customer promised",
      "Created Date": "05/04/2026 10:00:00 AM",
      "Last Updated Date": "05/04/2026 10:05:00 AM",
      "Promise Amount": "$75.00",
      "Promise Date": "05/05/2026",
      "Promised Result": "Kept",
    },
  });

  assert.equal(mapped?.deal_number, "A-100");
  assert.equal(mapped?.is_call, true);
  assert.equal(mapped?.is_sms, true);
  assert.equal(mapped?.is_outbound, true);
  assert.equal(mapped?.has_promise, true);
  assert.equal(mapped?.promise_kept, true);
});

test("DMS CSV parser handles quoted commas, escaped quotes, CRLF, and blank final lines", () => {
  const parsed = parseDmsCsv('Deal Number,Notes\r\nA-100,"hello, ""world"""\r\n\r\n');
  assert.deepEqual(parsed.headers, ["Deal Number", "Notes"]);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]["Notes"], 'hello, "world"');
});

class MockQuery {
  table: string;
  db: MockSupabase;
  selected = "";
  filters: Record<string, unknown> = {};

  constructor(table: string, db: MockSupabase) {
    this.table = table;
    this.db = db;
  }

  insert(payload: unknown) {
    this.db.calls.push({ table: this.table, op: "insert", payload });
    return this;
  }

  update(payload: unknown) {
    this.db.calls.push({ table: this.table, op: "update", payload });
    return this;
  }

  upsert(payload: unknown, options: unknown) {
    this.db.calls.push({ table: this.table, op: "upsert", payload, options });
    return Promise.resolve({ error: null });
  }

  select(columns: string) {
    this.selected = columns;
    return this;
  }

  single() {
    return Promise.resolve({ data: { id: "batch-1" }, error: null });
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  in(column: string, values: string[]) {
    const field = this.selected;
    const rows = values
      .filter((value) => this.db.existingKeys.has(value))
      .map((value) => ({ [field]: value }));
    this.db.calls.push({ table: this.table, op: "select_existing", column, values });
    return Promise.resolve({ data: rows, error: null });
  }
}

class MockSupabase {
  calls: Array<Record<string, unknown>> = [];
  existingKeys = new Set<string>();

  from(table: string) {
    return new MockQuery(table, this);
  }

  lastOp(table: string) {
    return [...this.calls].reverse().find((call) => call.table === table)?.op;
  }
}

test("DMS import service returns sanitized summary and writes batch plus upserts", async () => {
  const db = new MockSupabase();
  const existingHash = transactionHash({
    "Deal Identifier": "A-100",
    "Paid Date": "05/04/2026",
    "Paid Amount": "$100.00",
    "Transaction Type": "Payment",
    "Reference Number": "REF-1",
    "Last Updated Date": "",
    "Period Number": "1",
  });
  db.existingKeys.add(existingHash);

  const summary = await importDmsCsv({
    supabase: db,
    organizationId: "org-1",
    importedByUserId: "user-1",
    reportType: "payment_ledger",
    sourceFilename: "payments.csv",
    csvContent:
      "Paid Date,Paid Amount,Transaction Type,Period Number,Reference Number,Deal Identifier\n" +
      "05/04/2026,$100.00,Payment,1,REF-1,A-100\n" +
      "05/05/2026,$25.00,Payment,2,REF-2,\n",
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.batch_id, "batch-1");
  assert.equal(summary.row_count, 1);
  assert.equal(summary.updated, 1);
  assert.equal(summary.inserted, 0);
  assert.equal(summary.skipped, 1);
  assert.equal("raw_data" in summary, false);
  assert.equal(db.calls.some((call) => call.table === "dms_payment_ledger" && call.op === "upsert"), true);
  assert.equal(db.calls.some((call) => call.table === "dms_import_batches" && call.op === "update"), true);
});
