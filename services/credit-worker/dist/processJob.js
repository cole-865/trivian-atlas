// services/credit-worker/src/processJob.ts
//
// Downloads raw PDF -> extracts text (pdf-parse) -> de-dupes common “double extraction”
// -> scrubs targeted PII (DOB only when labeled) -> generates a redacted artifact PDF
// -> uploads to `credit_reports_redacted` -> updates credit_report_jobs.
//
// NOTES:
// - No `redacted_bucket` / `redacted_path` DB columns required.
// - Upload uses Uint8Array (avoids TS BlobPart issues in Node).
import pdf from "pdf-parse";
import { supabase } from "./supabase.js";
import { scrubPII } from "./scrub.js";
import { textToPdfBuffer } from "./textToPdf.js";
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
    // Versioned so reuploads don't overwrite and you can SEE activity in the bucket
    return rawPath.replace(/\.pdf$/i, "") + `.${jobId}.redacted.pdf`;
}
async function updateJobDone(jobId, extractedText, redactedText) {
    const { error } = await supabase
        .from("credit_report_jobs")
        .update({
        status: "done",
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
export async function processJob(job) {
    const jobId = job?.id;
    const rawBucket = job?.raw_bucket;
    const rawPath = job?.raw_path;
    if (!jobId)
        throw new Error("Job missing id");
    if (!rawBucket || !rawPath)
        throw new Error(`Job ${jobId} missing raw_bucket/raw_path`);
    const redactedPath = buildRedactedPath(rawPath, jobId);
    console.log("[credit-worker] processJob start", {
        jobId,
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
        console.log("[credit-worker] parsing pdf...");
        const parsed = await pdf(rawBuf);
        const extractedText = dedupeExtractedReportText(parsed?.text ?? "");
        console.log("[credit-worker] extracted chars:", extractedText.length);
        // 3) Scrub PII (DOB only, per your scrub rules)
        const redactedText = scrubPII(extractedText);
        console.log("[credit-worker] redacted chars:", redactedText.length);
        // 4) Build redacted artifact PDF (text-only)
        const redactedPdfBuf = await textToPdfBuffer(redactedText);
        console.log("[credit-worker] redacted pdf bytes:", redactedPdfBuf.length);
        // 5) Upload to redacted bucket (Uint8Array avoids Blob typing issues)
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
        // 6) Update job row
        await updateJobDone(jobId, extractedText, redactedText);
        console.log("[credit-worker] processJob done", { jobId, redactedPath });
        return { redactedBucket: REDACTED_BUCKET, redactedPath };
    }
    catch (err) {
        console.error("[credit-worker] processJob error:", jobId, err);
        await updateJobFailed(jobId, err);
        throw err;
    }
}
