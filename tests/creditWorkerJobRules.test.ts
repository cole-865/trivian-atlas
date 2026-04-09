import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRedactedPath,
  dedupeExtractedReportText,
  detectBureauFromText,
  resolveJobOrganization,
} from "../services/credit-worker/src/jobRules.js";

test("credit worker keeps the first duplicated Equifax extraction block", () => {
  const duplicated = [
    "Equifax-Style Report Generated from Equifax v6 Data",
    "Borrower One",
    "Account data",
    "Equifax-Style Report Generated from Equifax v6 Data",
    "Borrower One",
    "Account data",
  ].join("\n");

  assert.equal(
    dedupeExtractedReportText(duplicated),
    ["Equifax-Style Report Generated from Equifax v6 Data", "Borrower One", "Account data"].join(
      "\n"
    )
  );
});

test("credit worker detects supported bureau text and rejects unknown formats", () => {
  assert.equal(
    detectBureauFromText("Equifax-Style Report Generated from Equifax v6 Data"),
    "equifax"
  );
  assert.equal(
    detectBureauFromText("FICO Auto v9\nIDENTITY SCAN ALERT\nBorrower"),
    "equifax"
  );
  assert.equal(detectBureauFromText("TransUnion report sample"), "unknown");
});

test("credit worker redacted path preserves source path and appends job id", () => {
  assert.equal(
    buildRedactedPath("deal/123/bureau/report.pdf", "job-1"),
    "deal/123/bureau/report.job-1.redacted.pdf"
  );
});

test("credit worker stamps organization_id only when the job row is missing it", () => {
  assert.deepEqual(
    resolveJobOrganization({
      jobOrganizationId: "org-1",
      dealOrganizationId: "org-2",
    }),
    {
      organizationId: "org-1",
      shouldStampJob: false,
    }
  );

  assert.deepEqual(
    resolveJobOrganization({
      jobOrganizationId: null,
      dealOrganizationId: "org-2",
    }),
    {
      organizationId: "org-2",
      shouldStampJob: true,
    }
  );
});
