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
import pdf from "pdf-parse";
import { supabase } from "./supabase.js";
import { scrubPII } from "./scrub.js";
import { textToPdfBuffer } from "./textToPdf.js";
import { parseEquifaxReport } from "./parseEquifax.js";
import { underwriteDeal } from "./underwriteDeal.js";
const REDACTED_BUCKET = process.env.REDACTED_BUCKET || "credit_reports_redacted";
function dedupeExtractedReportText(text) {
    const t = (text || "").trim();
    if (!t)
        return t;
    const eqHeader = "Equifax-Style Report Generated";
    const first = t.indexOf(eqHeader);
    if (first !== -1) {
        const second = t.indexOf(eqHeader, first + eqHeader.length);
        if (second !== -1)
            return t.slice(0, second).trim();
    }
    const mid = Math.floor(t.length / 2);
    const a = t.slice(0, mid).trim();
    const b = t.slice(mid).trim();
    if (a.length > 2000) {
        const probe = a.slice(0, 2000);
        if (b.startsWith(probe))
            return a;
    }
    return t;
}
function buildRedactedPath(rawPath, jobId) {
    return rawPath.replace(/\.pdf$/i, "") + `.${jobId}.redacted.pdf`;
}
function detectBureauFromText(text) {
    if (/Equifax-Style Report Generated from Equifax v6 Data/i.test(text)) {
        return "equifax";
    }
    if (/FICO Auto v\d+/i.test(text) && /IDENTITY SCAN ALERT/i.test(text)) {
        return "equifax";
    }
    return "unknown";
}
async function updateJobStatus(jobId, status, extras = {}) {
    const payload = {
        status,
        ...extras,
    };
    const { error } = await supabase.from("credit_report_jobs").update(payload).eq("id", jobId);
    if (error)
        throw error;
}
async function updateJobDone(jobId, extractedText, redactedText, bureau) {
    const { error } = await supabase
        .from("credit_report_jobs")
        .update({
        status: "done",
        bureau,
        extracted_text: extractedText,
        redacted_text: redactedText,
        processed_at: new Date().toISOString(),
        error_message: null,
    })
        .eq("id", jobId);
    if (error)
        throw error;
}
async function updateJobFailed(jobId, err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const { error } = await supabase
        .from("credit_report_jobs")
        .update({
        status: "failed",
        error_message: message,
        processed_at: new Date().toISOString(),
    })
        .eq("id", jobId);
    if (error) {
        console.error("[credit-worker] failed to update job as failed:", jobId, error);
    }
}
async function upsertCreditReport(args) {
    const { dealId, jobId, bureau, rawBucket, rawPath, redactedBucket, redactedPath, redactedText, } = args;
    // Since upload route deletes previous credit_reports by deal_id,
    // one row per deal is fine here.
    const payload = {
        deal_id: dealId,
        bureau,
        raw_bucket: rawBucket,
        raw_path: rawPath,
        redacted_bucket: redactedBucket,
        redacted_path: redactedPath,
        redacted_text: redactedText,
        latest_job_id: jobId,
        updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
        .from("credit_reports")
        .upsert(payload, { onConflict: "deal_id" })
        .select("*")
        .single();
    if (error)
        throw error;
    return data;
}
async function replaceBureauDetails(args) {
    const { bureauSummaryId, dealId, tradelines, publicRecords, messages } = args;
    const { error: delTradelinesErr } = await supabase
        .from("bureau_tradelines")
        .delete()
        .eq("bureau_summary_id", bureauSummaryId);
    if (delTradelinesErr)
        throw delTradelinesErr;
    const { error: delPublicErr } = await supabase
        .from("bureau_public_records")
        .delete()
        .eq("bureau_summary_id", bureauSummaryId);
    if (delPublicErr)
        throw delPublicErr;
    const { error: delMessagesErr } = await supabase
        .from("bureau_messages")
        .delete()
        .eq("bureau_summary_id", bureauSummaryId);
    if (delMessagesErr)
        throw delMessagesErr;
    if (tradelines.length > 0) {
        const rows = tradelines.map((t) => ({
            bureau_summary_id: bureauSummaryId,
            deal_id: dealId,
            creditor_name: t.creditor_name,
            account_type: t.account_type,
            account_status: t.account_status,
            condition_code: t.condition_code,
            amount: t.amount,
            balance: t.balance,
            credit_limit: t.credit_limit,
            monthly_payment: t.monthly_payment,
            past_due_amount: t.past_due_amount,
            high_balance: t.high_balance,
            opened_date: t.opened_date,
            last_activity_date: t.last_activity_date,
            last_payment_date: t.last_payment_date,
            no_effect: t.no_effect,
            good: t.good,
            bad: t.bad,
            auto_repo: t.auto_repo,
            unpaid_collection: t.unpaid_collection,
            unpaid_chargeoff: t.unpaid_chargeoff,
            is_auto: t.is_auto,
            is_revolving: t.is_revolving,
            is_installment: t.is_installment,
            raw_segment: t.raw_segment ?? {},
            updated_at: new Date().toISOString(),
        }));
        const { error } = await supabase.from("bureau_tradelines").insert(rows);
        if (error)
            throw error;
    }
    if (publicRecords.length > 0) {
        const rows = publicRecords.map((r) => ({
            bureau_summary_id: bureauSummaryId,
            deal_id: dealId,
            court_name: r.court_name,
            record_type: r.record_type,
            plaintiff: r.plaintiff,
            amount: r.amount,
            status: r.status,
            filed_date: r.filed_date,
            resolved_date: r.resolved_date,
            no_effect: r.no_effect,
            good: r.good,
            bad: r.bad,
            raw_segment: r.raw_segment ?? {},
            updated_at: new Date().toISOString(),
        }));
        const { error } = await supabase.from("bureau_public_records").insert(rows);
        if (error)
            throw error;
    }
    if (messages.length > 0) {
        const rows = messages.map((m) => ({
            bureau_summary_id: bureauSummaryId,
            deal_id: dealId,
            message_type: m.message_type,
            code: m.code,
            message_text: m.message_text,
            severity: m.severity,
        }));
        const { error } = await supabase.from("bureau_messages").insert(rows);
        if (error)
            throw error;
    }
}
async function upsertBureauSummary(args) {
    const { dealId, creditReportId, jobId, parsed } = args;
    const s = parsed.summary;
    const payload = {
        deal_id: dealId,
        credit_report_id: creditReportId,
        job_id: jobId,
        bureau_source: s.bureau_source,
        score: s.score,
        total_tradelines: s.total_tradelines,
        open_tradelines: s.open_tradelines,
        open_auto_trade: s.open_auto_trade,
        months_since_repo: s.months_since_repo,
        months_since_bankruptcy: s.months_since_bankruptcy,
        total_collections: s.total_collections,
        total_chargeoffs: s.total_chargeoffs,
        past_due_amount: s.past_due_amount,
        utilization_pct: s.utilization_pct,
        oldest_trade_months: s.oldest_trade_months,
        autos_on_bureau: s.autos_on_bureau,
        open_auto_trades: s.open_auto_trades,
        paid_auto_trades: s.paid_auto_trades,
        repo_count: s.repo_count,
        risk_tier: s.risk_tier,
        max_term_months: s.max_term_months,
        min_cash_down: s.min_cash_down,
        max_pti: s.max_pti,
        hard_stop: s.hard_stop,
        hard_stop_reason: s.hard_stop_reason,
        stips: s.stips,
        bureau_raw: s.bureau_raw,
        updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
        .from("bureau_summary")
        .upsert(payload, { onConflict: "credit_report_id" })
        .select("*")
        .single();
    if (error)
        throw error;
    return data;
}
async function getUnderwritingInputs(dealId, vehicleId) {
    const { data: primaryPerson, error: personError } = await supabase
        .from("deal_people")
        .select("*")
        .eq("deal_id", dealId)
        .eq("role", "primary")
        .single();
    if (personError)
        throw personError;
    const { data: incomeProfile, error: incomeError } = await supabase
        .from("income_profiles")
        .select("*")
        .eq("deal_person_id", primaryPerson.id)
        .eq("applied_to_deal", true)
        .single();
    if (incomeError)
        throw incomeError;
    let vehicle = null;
    if (vehicleId) {
        const { data: vehicleRow, error: vehicleError } = await supabase
            .from("trivian_inventory")
            .select("*")
            .eq("id", vehicleId)
            .single();
        if (vehicleError)
            throw vehicleError;
        vehicle = vehicleRow;
    }
    return {
        primaryPerson,
        incomeProfile,
        vehicle,
    };
}
export async function processJob(job) {
    const jobId = job?.id;
    const dealId = job?.deal_id;
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
        const dl = await supabase.storage.from(rawBucket).download(rawPath);
        if (dl.error)
            throw dl.error;
        if (!dl.data)
            throw new Error("Storage download returned no data");
        const rawBuf = Buffer.from(await dl.data.arrayBuffer());
        console.log("[credit-worker] downloaded bytes:", rawBuf.length);
        // 2) Extract text
        await updateJobStatus(jobId, "parsing");
        console.log("[credit-worker] parsing pdf...");
        const parsedPdf = await pdf(rawBuf);
        const extractedText = dedupeExtractedReportText(parsedPdf?.text ?? "");
        console.log("[credit-worker] extracted chars:", extractedText.length);
        if (!extractedText.trim()) {
            throw new Error("No text extracted from PDF");
        }
        // 3) Detect bureau + parse structured data
        const bureau = detectBureauFromText(extractedText);
        console.log("[credit-worker] detected bureau:", bureau);
        let parsedBureau = null;
        if (bureau === "equifax") {
            parsedBureau = parseEquifaxReport(extractedText);
        }
        else {
            throw new Error("Unsupported bureau format: unable to detect supported parser");
        }
        // 4) Redact display text + upload redacted artifact
        await updateJobStatus(jobId, "redacting", { bureau });
        const redactedText = scrubPII(extractedText);
        console.log("[credit-worker] redacted chars:", redactedText.length);
        const redactedPdfBuf = await textToPdfBuffer(redactedText);
        console.log("[credit-worker] redacted pdf bytes:", redactedPdfBuf.length);
        const body = new Uint8Array(redactedPdfBuf);
        console.log("[credit-worker] uploading redacted file", {
            bucket: REDACTED_BUCKET,
            path: redactedPath,
            size: body.byteLength,
        });
        const uploadRes = await supabase.storage
            .from(REDACTED_BUCKET)
            .upload(redactedPath, body, {
            contentType: "application/pdf",
            upsert: true,
        });
        console.log("[credit-worker] upload result", uploadRes);
        if (uploadRes.error)
            throw uploadRes.error;
        // 5) Upsert report + bureau data
        await updateJobStatus(jobId, "scoring", { bureau });
        console.log("[credit-worker] about to upsert credit_reports + bureau_summary", {
            jobId,
            dealId,
            bureau,
        });
        const creditReport = await upsertCreditReport({
            dealId,
            jobId,
            bureau,
            rawBucket,
            rawPath,
            redactedBucket: REDACTED_BUCKET,
            redactedPath,
            redactedText,
        });
        const bureauSummary = await upsertBureauSummary({
            dealId,
            creditReportId: creditReport.id,
            jobId,
            parsed: parsedBureau,
        });
        await replaceBureauDetails({
            bureauSummaryId: bureauSummary.id,
            dealId,
            tradelines: parsedBureau.tradelines,
            publicRecords: parsedBureau.publicRecords,
            messages: parsedBureau.messages,
        });
        const { data: primaryPerson, error: personError } = await supabase
            .from("deal_people")
            .select("*")
            .eq("deal_id", dealId)
            .eq("role", "primary")
            .single();
        if (personError)
            throw personError;
        const uw = await underwriteDeal({
            incomeMonthly: 999999, // placeholder so Step 1 doesn't false-deny for missing income
            score: bureauSummary.score,
            repoCount: Number(bureauSummary.repo_count ?? 0),
            monthsSinceRepo: bureauSummary.months_since_repo,
            paidAutoTrades: Number(bureauSummary.paid_auto_trades ?? 0),
            openAutoTrades: Number(bureauSummary.open_auto_trades ?? 0),
            residenceMonths: primaryPerson.residence_months,
            jobMonths: null,
            cashDown: 0,
            vehiclePrice: 0,
        });
        await supabase
            .from("underwriting_results")
            .upsert({
            deal_id: dealId,
            user_id: job.uploaded_by ?? null,
            stage: "bureau_precheck",
            score_total: uw.scoreTotal,
            decision: uw.decision,
            notes: uw.notes,
            tier: uw.tier,
            max_term_months: uw.maxTermMonths,
            min_cash_down: uw.minCashDown,
            min_down_pct: uw.minDownPct,
            max_pti: uw.maxPti,
            max_amount_financed: uw.maxAmountFinanced,
            max_vehicle_price: uw.maxVehiclePrice,
            max_ltv: uw.maxLtv,
            apr: uw.apr,
            hard_stop: uw.hardStop,
            hard_stop_reason: uw.hardStopReason,
            score_factors: uw.scoreFactors,
            updated_at: new Date().toISOString(),
        }, { onConflict: "deal_id,stage" });
        // 6) Finalize job row
        await updateJobDone(jobId, extractedText, redactedText, bureau);
        console.log("[credit-worker] processJob done", {
            jobId,
            dealId,
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
        await updateJobFailed(jobId, err);
        throw err;
    }
}
