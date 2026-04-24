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
function asRecord(value) {
    return value && typeof value === "object" ? value : null;
}
function numberOrNull(value) {
    if (value === null || value === undefined || value === "")
        return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function booleanOrNull(value) {
    return typeof value === "boolean" ? value : null;
}
function getTierCapSignals(summary) {
    const raw = asRecord(summary.bureau_raw);
    return (asRecord(raw?.tier_cap_signals) ?? {});
}
import { buildRedactedPath, dedupeExtractedReportText, detectBureauFromText, resolveJobOrganization, } from "./jobRules.js";
import { parseEquifaxReport } from "./parseEquifax.js";
const REDACTED_BUCKET = process.env.REDACTED_BUCKET || "credit_reports_redacted";
function toApplicantInput(summary, person, hireDate = null) {
    if (!summary)
        return null;
    const tierCapSignals = getTierCapSignals(summary);
    return {
        score: summary.score != null ? Number(summary.score) : null,
        repoCount: Number(summary.repo_count ?? 0),
        monthsSinceRepo: summary.months_since_repo != null ? Number(summary.months_since_repo) : null,
        paidAutoTrades: Number(summary.paid_auto_trades ?? 0),
        openAutoTrades: Number(summary.open_auto_trades ?? 0),
        residenceMonths: person?.residence_months != null ? Number(person.residence_months) : null,
        monthsSinceBankruptcy: numberOrNull(tierCapSignals.months_since_bankruptcy) ??
            numberOrNull(summary.months_since_bankruptcy),
        unresolvedCollectionsCount: numberOrNull(tierCapSignals.unresolved_collections_count),
        unresolvedChargeoffsCount: numberOrNull(tierCapSignals.unresolved_chargeoffs_count),
        publicRecordCount: numberOrNull(tierCapSignals.public_record_count),
        bankruptcyCount: numberOrNull(tierCapSignals.bankruptcy_count),
        bankruptcyDateUnknown: booleanOrNull(tierCapSignals.bankruptcy_date_unknown),
        pastDueAmount: summary.past_due_amount != null ? Number(summary.past_due_amount) : null,
        totalTradelines: summary.total_tradelines != null ? Number(summary.total_tradelines) : null,
        openTradelines: summary.open_tradelines != null ? Number(summary.open_tradelines) : null,
        autosOnBureau: summary.autos_on_bureau != null ? Number(summary.autos_on_bureau) : null,
        openAutoDerogatory: booleanOrNull(tierCapSignals.open_auto_derogatory),
        autoDeficiency: booleanOrNull(tierCapSignals.auto_deficiency),
        majorDerogAfterPublicRecord: booleanOrNull(tierCapSignals.major_derog_after_public_record),
        hireDate,
    };
}
export async function processJob(job, dependencies = {}) {
    const gateway = dependencies.gateway ??
        (await import("./gateway.js")).defaultCreditWorkerGateway;
    const parsePdfText = dependencies.parsePdfText ??
        (async (raw) => {
            const { default: pdf } = await import("pdf-parse");
            const parsedPdf = await pdf(raw);
            return parsedPdf?.text ?? "";
        });
    const parseBureau = dependencies.parseBureau ?? parseEquifaxReport;
    const scrubText = dependencies.scrubText ??
        (async (text) => {
            const { scrubPII } = await import("./scrub.js");
            return scrubPII(text);
        });
    const renderRedactedPdf = dependencies.renderRedactedPdf ??
        (async (text) => {
            const { textToPdfBuffer } = await import("./textToPdf.js");
            return textToPdfBuffer(text);
        });
    const underwrite = dependencies.underwrite ??
        (async ({ scoring }) => {
            const { underwriteDealTier } = await import("./underwriteDeal.js");
            return underwriteDealTier(scoring);
        });
    const jobId = job?.id;
    const dealId = job?.deal_id;
    const applicantRole = job?.applicant_role === "co" ? "co" : "primary";
    const jobOrganizationId = job?.organization_id ?? null;
    const rawBucket = job?.raw_bucket;
    const rawPath = job?.raw_path;
    console.log("[credit-worker] NEW PARSE/UPSERT BUILD ACTIVE", {
        jobId,
        dealId,
        rawBucket,
        rawPath,
    });
    if (!jobId)
        throw new Error("Job missing id");
    if (!dealId)
        throw new Error(`Job ${jobId} missing deal_id`);
    if (!rawBucket || !rawPath)
        throw new Error(`Job ${jobId} missing raw_bucket/raw_path`);
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
        const primarySummary = applicantRole === "primary"
            ? bureauSummary
            : await gateway.loadLatestBureauSummary(organizationId, dealId, "primary");
        if (primarySummary) {
            const [primaryPerson, coPerson, householdIncome] = await Promise.all([
                gateway.loadApplicantPerson(organizationId, dealId, "primary"),
                gateway.loadApplicantPerson(organizationId, dealId, "co"),
                gateway.getDealHouseholdIncome(organizationId, dealId),
            ]);
            if (!primaryPerson) {
                throw new Error(`Deal ${dealId} is missing primary applicant`);
            }
            const coSummary = applicantRole === "co"
                ? bureauSummary
                : await gateway.loadLatestBureauSummary(organizationId, dealId, "co");
            const [primaryHireDate, coHireDate, coHasAppliedIncome] = await Promise.all([
                gateway.getAppliedIncomeHireDateForPerson(organizationId, primaryPerson.id),
                coPerson
                    ? gateway.getAppliedIncomeHireDateForPerson(organizationId, coPerson.id)
                    : Promise.resolve(null),
                coPerson
                    ? gateway.hasAppliedIncomeForPerson(organizationId, coPerson.id)
                    : Promise.resolve(false),
            ]);
            const uw = await underwrite({
                scoring: {
                    primary: toApplicantInput(primarySummary, primaryPerson, primaryHireDate),
                    coApplicant: toApplicantInput(coSummary, coPerson, coHireDate),
                    coApplicantContext: {
                        householdIncome,
                        hasAppliedIncome: coHasAppliedIncome,
                        primaryAddress: primaryPerson.address,
                        coApplicantAddress: coPerson?.address ?? null,
                    },
                },
            });
            await gateway.upsertUnderwritingResult({
                organizationId,
                dealId,
                uploadedBy: job.uploaded_by ?? null,
                result: uw,
            });
        }
        else {
            console.log("[credit-worker] skipped underwriting refresh; primary bureau missing", {
                jobId,
                dealId,
                applicantRole,
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
    }
    catch (err) {
        console.error("[credit-worker] processJob error:", jobId, err);
        await gateway.markJobFailed(jobId, err);
        throw err;
    }
}
