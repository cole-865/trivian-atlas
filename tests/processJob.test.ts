import test from "node:test";
import assert from "node:assert/strict";
import type {
  CreditReportJobRow,
  CreditWorkerGateway,
  ParsedBureauReport,
  UnderwriteResult,
} from "../services/credit-worker/src/gateway.js";
import { processJob } from "../services/credit-worker/src/processJob.js";

function createGateway(overrides?: Partial<CreditWorkerGateway>) {
  const calls: string[] = [];

  const gateway: CreditWorkerGateway = {
    async getDealOrganizationId() {
      calls.push("getDealOrganizationId");
      return "org-1";
    },
    async getDealHouseholdIncome() {
      calls.push("getDealHouseholdIncome");
      return false;
    },
    async stampJobOrganization() {
      calls.push("stampJobOrganization");
    },
    async updateJobStatus(_jobId, status) {
      calls.push(`updateJobStatus:${status}`);
    },
    async markJobFailed() {
      calls.push("markJobFailed");
    },
    async downloadRawPdf() {
      calls.push("downloadRawPdf");
      return Buffer.from("raw");
    },
    async uploadRedactedPdf() {
      calls.push("uploadRedactedPdf");
    },
    async upsertCreditReport() {
      calls.push("upsertCreditReport");
      return { id: "report-1" };
    },
    async upsertBureauSummary() {
      calls.push("upsertBureauSummary");
      return {
        id: "summary-1",
        score: 640,
        repo_count: 0,
        months_since_repo: null,
        paid_auto_trades: 2,
        open_auto_trades: 1,
      };
    },
    async replaceBureauDetails() {
      calls.push("replaceBureauDetails");
    },
    async loadApplicantPerson() {
      calls.push("loadApplicantPerson");
      return {
        id: "person-1",
        residence_months: 24,
        address: {
          addressLine1: "123 Main St",
          city: "Austin",
          state: "TX",
          zip: "78701",
        },
      };
    },
    async loadLatestBureauSummary(_organizationId, _dealId, applicantRole) {
      calls.push(`loadLatestBureauSummary:${applicantRole}`);
      return applicantRole === "primary"
        ? {
            id: "summary-primary",
            score: 640,
            repo_count: 0,
            months_since_repo: null,
            paid_auto_trades: 2,
            open_auto_trades: 1,
          }
        : null;
    },
    async hasAppliedIncomeForPerson() {
      calls.push("hasAppliedIncomeForPerson");
      return false;
    },
    async upsertUnderwritingResult() {
      calls.push("upsertUnderwritingResult");
    },
    ...overrides,
  };

  return { gateway, calls };
}

function createParsedBureau(): ParsedBureauReport {
  return {
    bureau: "equifax",
    summary: {
      bureau_source: "equifax",
      score: 640,
      total_tradelines: 3,
      open_tradelines: 2,
      open_auto_trade: 1,
      months_since_repo: null,
      months_since_bankruptcy: null,
      total_collections: 0,
      total_chargeoffs: 0,
      past_due_amount: 0,
      utilization_pct: 0.2,
      oldest_trade_months: 24,
      autos_on_bureau: 1,
      open_auto_trades: 1,
      paid_auto_trades: 2,
      repo_count: 0,
      risk_tier: "B",
      max_term_months: 48,
      min_cash_down: 1000,
      max_pti: 0.22,
      hard_stop: false,
      hard_stop_reason: null,
      stips: [],
      bureau_raw: {},
    },
    tradelines: [],
    publicRecords: [],
    messages: [],
  };
}

function createUnderwriteResult(): UnderwriteResult {
  return {
    decision: "approved",
    tier: "B",
    scoreTotal: 1.5,
    hardStop: false,
    hardStopReason: null,
    maxTermMonths: 48,
    minCashDown: 1000,
    minDownPct: 0.1,
    maxPti: 0.22,
    maxAmountFinanced: 20000,
    maxVehiclePrice: 22000,
    maxLtv: 1.2,
    apr: 24.99,
    scoreFactors: [],
    notes: "ok",
  };
}

test("processJob orchestrates the happy path and stamps missing organization ids", async () => {
  const { gateway, calls } = createGateway();
  const job: CreditReportJobRow = {
    id: "job-1",
    deal_id: "deal-1",
    organization_id: null,
    uploaded_by: "user-1",
    raw_bucket: "raw",
    raw_path: "deal/1/report.pdf",
    applicant_role: "primary",
  };

  const result = await processJob(job, {
    gateway,
    parsePdfText: async () => "Equifax-Style Report Generated from Equifax v6 Data\nBorrower",
    parseBureau: () => createParsedBureau(),
    scrubText: (text) => `scrubbed:${text}`,
    renderRedactedPdf: async () => Buffer.from("pdf"),
    underwrite: async () => createUnderwriteResult(),
  });

  assert.equal(result.bureau, "equifax");
  assert.equal(result.redactedPath, "deal/1/report.job-1.redacted.pdf");
  assert.deepEqual(calls, [
    "getDealOrganizationId",
    "stampJobOrganization",
    "downloadRawPdf",
    "updateJobStatus:parsing",
    "updateJobStatus:redacting",
    "uploadRedactedPdf",
    "updateJobStatus:scoring",
    "upsertCreditReport",
    "upsertBureauSummary",
    "replaceBureauDetails",
    "loadApplicantPerson",
    "loadApplicantPerson",
    "getDealHouseholdIncome",
    "loadLatestBureauSummary:co",
    "hasAppliedIncomeForPerson",
    "upsertUnderwritingResult",
    "updateJobStatus:done",
  ]);
});

test("processJob skips organization stamping when the queued job already has organization_id", async () => {
  const { gateway, calls } = createGateway();

  await processJob(
    {
      id: "job-2",
      deal_id: "deal-2",
      organization_id: "org-1",
      uploaded_by: "user-1",
      raw_bucket: "raw",
      raw_path: "deal/2/report.pdf",
      applicant_role: "primary",
    },
    {
      gateway,
      parsePdfText: async () => "Equifax-Style Report Generated from Equifax v6 Data",
      parseBureau: () => createParsedBureau(),
      scrubText: (text) => text,
      renderRedactedPdf: async () => Buffer.from("pdf"),
      underwrite: async () => createUnderwriteResult(),
    }
  );

  assert.equal(calls.includes("stampJobOrganization"), false);
});

test("processJob marks the job failed when redacted upload fails", async () => {
  const { gateway, calls } = createGateway({
    async uploadRedactedPdf() {
      calls.push("uploadRedactedPdf");
      throw new Error("upload failed");
    },
  });

  await assert.rejects(
    processJob(
      {
        id: "job-3",
        deal_id: "deal-3",
        organization_id: "org-1",
        uploaded_by: "user-1",
        raw_bucket: "raw",
        raw_path: "deal/3/report.pdf",
        applicant_role: "primary",
      },
      {
        gateway,
        parsePdfText: async () => "Equifax-Style Report Generated from Equifax v6 Data",
        parseBureau: () => createParsedBureau(),
        scrubText: (text) => text,
        renderRedactedPdf: async () => Buffer.from("pdf"),
        underwrite: async () => createUnderwriteResult(),
      }
    ),
    /upload failed/
  );

  assert.equal(calls.includes("markJobFailed"), true);
  assert.equal(calls.includes("updateJobStatus:done"), false);
});

test("processJob fails unsupported bureau formats before any downstream upserts", async () => {
  const { gateway, calls } = createGateway();

  await assert.rejects(
    processJob(
      {
        id: "job-4",
        deal_id: "deal-4",
        organization_id: "org-1",
        uploaded_by: "user-1",
        raw_bucket: "raw",
        raw_path: "deal/4/report.pdf",
        applicant_role: "primary",
      },
      {
        gateway,
        parsePdfText: async () => "Unsupported bureau text",
        parseBureau: () => createParsedBureau(),
        scrubText: (text) => text,
        renderRedactedPdf: async () => Buffer.from("pdf"),
        underwrite: async () => createUnderwriteResult(),
      }
    ),
    /Unsupported bureau format/
  );

  assert.equal(calls.includes("upsertCreditReport"), false);
  assert.equal(calls.includes("upsertBureauSummary"), false);
  assert.equal(calls.includes("markJobFailed"), true);
});

test("processJob stores co-app bureau data without refreshing deal underwriting when primary bureau is missing", async () => {
  const { gateway, calls } = createGateway({
    async loadLatestBureauSummary(_organizationId, _dealId, applicantRole) {
      calls.push(`loadLatestBureauSummary:${applicantRole}`);
      return null;
    },
  });

  await processJob(
    {
      id: "job-5",
      deal_id: "deal-5",
      organization_id: "org-1",
      uploaded_by: "user-1",
      raw_bucket: "raw",
      raw_path: "deal/5/report.pdf",
      applicant_role: "co",
    },
    {
      gateway,
      parsePdfText: async () => "Equifax-Style Report Generated from Equifax v6 Data",
      parseBureau: () => createParsedBureau(),
      scrubText: (text) => text,
      renderRedactedPdf: async () => Buffer.from("pdf"),
      underwrite: async () => createUnderwriteResult(),
    }
  );

  assert.equal(calls.includes("loadLatestBureauSummary:primary"), true);
  assert.equal(calls.includes("upsertUnderwritingResult"), false);
});

test("processJob refreshes underwriting from a co-app bureau when primary bureau already exists", async () => {
  const { gateway, calls } = createGateway({
    async getDealHouseholdIncome() {
      calls.push("getDealHouseholdIncome");
      return true;
    },
    async loadApplicantPerson(_organizationId, _dealId, applicantRole) {
      calls.push(`loadApplicantPerson:${applicantRole}`);
      return {
        id: applicantRole === "primary" ? "primary-person" : "co-person",
        residence_months: applicantRole === "primary" ? 18 : 36,
        address: {
          addressLine1: "123 Main St.",
          city: "Austin",
          state: "TX",
          zip: "78701",
        },
      };
    },
    async hasAppliedIncomeForPerson() {
      calls.push("hasAppliedIncomeForPerson");
      return true;
    },
  });

  await processJob(
    {
      id: "job-6",
      deal_id: "deal-6",
      organization_id: "org-1",
      uploaded_by: "user-1",
      raw_bucket: "raw",
      raw_path: "deal/6/report.pdf",
      applicant_role: "co",
    },
    {
      gateway,
      parsePdfText: async () => "Equifax-Style Report Generated from Equifax v6 Data",
      parseBureau: () => createParsedBureau(),
      scrubText: (text) => text,
      renderRedactedPdf: async () => Buffer.from("pdf"),
      underwrite: async ({ scoring }) => {
        assert.equal(scoring.primary?.paidAutoTrades, 2);
        assert.equal(scoring.coApplicant?.paidAutoTrades, 2);
        assert.equal(scoring.coApplicantContext?.householdIncome, true);
        assert.equal(scoring.coApplicantContext?.hasAppliedIncome, true);
        return createUnderwriteResult();
      },
    }
  );

  assert.equal(calls.includes("upsertUnderwritingResult"), true);
});
