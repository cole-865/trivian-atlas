// services/credit-worker/src/processJob.ts
//
// Downloads raw PDF -> extracts text -> de-dupes duplicated Equifax extraction
// -> parses bureau data -> scrubs targeted PII for display -> generates redacted PDF
// -> uploads redacted artifact -> upserts credit_reports + bureau tables
// -> updates credit_report_jobs.
//
// Notes:
// - Parsing happens from extracted text, not the redacted text.
// - Redacted text/PDF is for safer display and downstream minimized usage.
// - This file assumes the following tables now exist:
//   - credit_reports
//   - bureau_summary
//   - bureau_tradelines
//   - bureau_public_records
//   - bureau_messages

import {
  type CreditReportJobRow,
  type CreditWorkerGateway,
  type ParsedBureauReport,
} from "./gateway.js";
import {
  buildRedactedPath,
  dedupeExtractedReportText,
  detectBureauFromText,
  resolveJobOrganization,
} from "./jobRules.js";
import { parseEquifaxReport } from "./parseEquifax.js";

const REDACTED_BUCKET = process.env.REDACTED_BUCKET || "credit_reports_redacted";

type ProcessJobDependencies = {
  gateway?: CreditWorkerGateway;
  parsePdfText?: (raw: Buffer) => Promise<string>;
  parseBureau?: (text: string) => ParsedBureauReport;
  scrubText?: (text: string) => string | Promise<string>;
  renderRedactedPdf?: (text: string) => Promise<Buffer>;
  underwrite?: (args: {
    incomeMonthly: number;
    score: number | null;
    repoCount: number;
    monthsSinceRepo: number | null;
    paidAutoTrades: number;
    openAutoTrades: number;
    residenceMonths: number | null;
    jobMonths: number | null;
    cashDown: number;
    vehiclePrice: number;
  }) => Promise<import("./gateway.js").UnderwriteResult>;
};

export async function processJob(
  job: CreditReportJobRow,
  dependencies: ProcessJobDependencies = {}
) {
  const gateway =
    dependencies.gateway ??
    (await import("./gateway.js")).defaultCreditWorkerGateway;
  const parsePdfText =
    dependencies.parsePdfText ??
    (async (raw: Buffer) => {
      const { default: pdf } = await import("pdf-parse");
      const parsedPdf = await pdf(raw);
      return parsedPdf?.text ?? "";
    });
  const parseBureau = dependencies.parseBureau ?? parseEquifaxReport;
  const scrubText =
    dependencies.scrubText ??
    (async (text: string) => {
      const { scrubPII } = await import("./scrub.js");
      return scrubPII(text);
    });
  const renderRedactedPdf =
    dependencies.renderRedactedPdf ??
    (async (text: string) => {
      const { textToPdfBuffer } = await import("./textToPdf.js");
      return textToPdfBuffer(text);
    });
  const underwrite =
    dependencies.underwrite ??
    (async (args) => {
      const { underwriteDeal } = await import("./underwriteDeal.js");
      return underwriteDeal(args);
    });
  const jobId: string = job?.id;
  const dealId: string = job?.deal_id;
  const applicantRole: "primary" | "co" = job?.applicant_role === "co" ? "co" : "primary";
  const jobOrganizationId: string | null = job?.organization_id ?? null;
  const rawBucket: string = job?.raw_bucket;
  const rawPath: string = job?.raw_path;

  console.log("[credit-worker] NEW PARSE/UPSERT BUILD ACTIVE", {
    jobId,
    dealId,
    rawBucket,
    rawPath,
  });

  if (!jobId) throw new Error("Job missing id");
  if (!dealId) throw new Error(`Job ${jobId} missing deal_id`);
  if (!rawBucket || !rawPath) throw new Error(`Job ${jobId} missing raw_bucket/raw_path`);

  const resolvedDealOrganizationId = jobOrganizationId
    ? jobOrganizationId
    : await gateway.getDealOrganizationId(dealId);
  const { organizationId, shouldStampJob } = resolveJobOrganization({
    jobOrganizationId,
    dealOrganizationId: resolvedDealOrganizationId,
  });

  if (shouldStampJob) {
    await gateway.stampJobOrganization(jobId, organizationId);
  }

  const redactedPath = buildRedactedPath(rawPath, jobId);

  console.log("[credit-worker] processJob start", {
    jobId,
    dealId,
    rawBucket,
    rawPath,
    redactedBucket: REDACTED_BUCKET,
    redactedPath,
  });

  try {
    // 1) Download raw PDF
    console.log("[credit-worker] downloading raw", { rawBucket, rawPath });
    const rawBuf = await gateway.downloadRawPdf(rawBucket, rawPath);
    console.log("[credit-worker] downloaded bytes:", rawBuf.length);

    // 2) Extract text
    await gateway.updateJobStatus(jobId, "parsing");
    console.log("[credit-worker] parsing pdf...");
    const extractedText = dedupeExtractedReportText(await parsePdfText(rawBuf));
    console.log("[credit-worker] extracted chars:", extractedText.length);

    if (!extractedText.trim()) {
      throw new Error("No text extracted from PDF");
    }

    // 3) Detect bureau + parse structured data
    const bureau = detectBureauFromText(extractedText);
    console.log("[credit-worker] detected bureau:", bureau);

    if (bureau !== "equifax") {
      throw new Error("Unsupported bureau format: unable to detect supported parser");
    }
    const parsedBureau = parseBureau(extractedText);

    // 4) Redact display text + upload redacted artifact
    await gateway.updateJobStatus(jobId, "redacting", { bureau });
    const redactedText = await scrubText(extractedText);
    console.log("[credit-worker] redacted chars:", redactedText.length);

    const redactedPdfBuf = await renderRedactedPdf(redactedText);
    console.log("[credit-worker] redacted pdf bytes:", redactedPdfBuf.length);

    const body = new Uint8Array(redactedPdfBuf);

    console.log("[credit-worker] uploading redacted file", {
      bucket: REDACTED_BUCKET,
      path: redactedPath,
      size: body.byteLength,
    });

    await gateway.uploadRedactedPdf(REDACTED_BUCKET, redactedPath, body);
    console.log("[credit-worker] upload complete");

    // 5) Upsert report + bureau data
    await gateway.updateJobStatus(jobId, "scoring", { bureau });

    console.log("[credit-worker] about to upsert credit_reports + bureau_summary", {
      jobId,
      dealId,
      applicantRole,
      bureau,
    });

    const creditReport = await gateway.upsertCreditReport({
      applicantRole,
      organizationId,
      dealId,
      jobId,
      bureau,
      rawBucket,
      rawPath,
      redactedBucket: REDACTED_BUCKET,
      redactedPath,
      redactedText,
    });

    const bureauSummary = await gateway.upsertBureauSummary({
      applicantRole,
      organizationId,
      dealId,
      creditReportId: creditReport.id,
      jobId,
      parsed: parsedBureau,
    });

    await gateway.replaceBureauDetails({
      applicantRole,
      organizationId,
      bureauSummaryId: bureauSummary.id,
      dealId,
      tradelines: parsedBureau.tradelines,
      publicRecords: parsedBureau.publicRecords,
      messages: parsedBureau.messages,
    });

    if (applicantRole === "primary") {
      const applicantPerson = await gateway.loadApplicantPerson(organizationId, dealId, applicantRole);

      const uw = await underwrite({
        incomeMonthly: 999999, // placeholder so Step 1 doesn't false-deny for missing income
        score: bureauSummary.score,
        repoCount: Number(bureauSummary.repo_count ?? 0),
        monthsSinceRepo: bureauSummary.months_since_repo ?? null,
        paidAutoTrades: Number(bureauSummary.paid_auto_trades ?? 0),
        openAutoTrades: Number(bureauSummary.open_auto_trades ?? 0),
        residenceMonths: applicantPerson.residence_months,
        jobMonths: null,
        cashDown: 0,
        vehiclePrice: 0,
      });

      await gateway.upsertUnderwritingResult({
        organizationId,
        dealId,
        uploadedBy: job.uploaded_by ?? null,
        result: uw,
      });
    }

    // 6) Finalize job row
    await gateway.updateJobStatus(jobId, "done", {
      bureau,
      extracted_text: extractedText,
      redacted_text: redactedText,
      processed_at: new Date().toISOString(),
      error_message: null,
    });

    console.log("[credit-worker] processJob done", {
      jobId,
      dealId,
      applicantRole,
      bureau,
      creditReportId: creditReport.id,
      bureauSummaryId: bureauSummary.id,
      redactedPath,
      tradelines: parsedBureau.tradelines.length,
      publicRecords: parsedBureau.publicRecords.length,
      messages: parsedBureau.messages.length,
    });

    return {
      redactedBucket: REDACTED_BUCKET,
      redactedPath,
      bureau,
      creditReportId: creditReport.id,
      bureauSummaryId: bureauSummary.id,
    };
  } catch (err) {
    console.error("[credit-worker] processJob error:", jobId, err);
    await gateway.markJobFailed(jobId, err);
    throw err;
  }
}
