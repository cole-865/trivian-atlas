// services/credit-worker/src/index.ts
//
// Realtime-first worker (no 3-second loop)
// - Boot sanity check: confirms worker can see the DB + shows latest job it can see
// - Catch-up on boot: processes any queued jobs that existed while worker was down
// - Realtime listener: reacts to INSERT + status transitions to queued on UPDATE
// - Safety net: catch-up every 60s (not spammy, prevents “realtime missed it” failures)
//
// Requires Supabase Realtime replication enabled for: public.credit_report_jobs
// Supabase Dashboard -> Database -> Replication -> enable for credit_report_jobs
//
// Env (services/credit-worker/.env):
//   SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...
// Optional:
//   WORKER_ID=credit-worker-1
//   CATCHUP_LIMIT=25
//   CATCHUP_INTERVAL_MS=5000
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
import http from "node:http";
import { supabase } from "./supabase.js";
import { processJob } from "./processJob.js";
import { formatWorkerError } from "./errorFormatting.js";
const WORKER_ID = process.env.WORKER_ID || "credit-worker-1";
const CATCHUP_LIMIT = Number(process.env.CATCHUP_LIMIT || "25");
const CATCHUP_INTERVAL_MS = Number(process.env.CATCHUP_INTERVAL_MS || "5000");
const HEALTH_PORT = Number(process.env.PORT || process.env.HEALTH_PORT || "8080");
const startedAt = new Date().toISOString();
// Prevent duplicate processing bursts (INSERT + UPDATE can both fire)
const inFlight = new Set();
let realtimeStatus = null;
let lastCatchUpAt = null;
let lastCatchUpError = null;
let lastSanityCheckAt = null;
let lastSanityCheckError = null;
console.log("[credit-worker] boot", new Date().toISOString());
console.log("[credit-worker] cwd:", process.cwd());
console.log("[credit-worker] WORKER_ID:", WORKER_ID);
console.log("[credit-worker] CATCHUP_LIMIT:", CATCHUP_LIMIT);
console.log("[credit-worker] CATCHUP_INTERVAL_MS:", CATCHUP_INTERVAL_MS);
console.log("[credit-worker] HEALTH_PORT:", HEALTH_PORT);
console.log("[credit-worker] SUPABASE host:", process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : "(missing)");
function startHealthServer() {
    const server = http.createServer((req, res) => {
        if (req.url !== "/" && req.url !== "/health") {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "not_found" }));
            return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
            ok: true,
            service: "credit-worker",
            workerId: WORKER_ID,
            startedAt,
            realtimeStatus,
            lastCatchUpAt,
            lastCatchUpError,
            lastSanityCheckAt,
            lastSanityCheckError,
            inFlight: inFlight.size,
        }));
    });
    server.listen(HEALTH_PORT, "0.0.0.0", () => {
        console.log(`[credit-worker] health listening on :${HEALTH_PORT}`);
    });
}
async function sanityCheckDb() {
    try {
        lastSanityCheckAt = new Date().toISOString();
        lastSanityCheckError = null;
        const { data, error } = await supabase
            .from("credit_report_jobs")
            .select("id,status,applicant_role,created_at")
            .order("created_at", { ascending: false })
            .limit(1);
        if (error) {
            lastSanityCheckError = formatWorkerError(error);
            console.error("[credit-worker] sanityCheckDb query error:", error);
            return;
        }
        console.log("[credit-worker] latest job visible to worker:", data?.[0] ?? "(none)");
    }
    catch (e) {
        lastSanityCheckError = formatWorkerError(e);
        console.error("[credit-worker] sanityCheckDb crashed:", e);
    }
}
async function claimJob(jobId) {
    const { data, error } = await supabase
        .from("credit_report_jobs")
        .update({
        status: "parsing",
        locked_by: WORKER_ID,
        locked_at: new Date().toISOString(),
        error_message: null,
    })
        .eq("id", jobId)
        .eq("status", "queued")
        .select("*");
    if (error) {
        console.error("[credit-worker] claim error:", error);
        return null;
    }
    return data && data.length > 0 ? data[0] : null;
}
async function markFailed(jobId, err) {
    const message = formatWorkerError(err);
    const { error } = await supabase
        .from("credit_report_jobs")
        .update({
        status: "failed",
        error_message: message,
        processed_at: new Date().toISOString(),
    })
        .eq("id", jobId);
    if (error) {
        console.error("[credit-worker] failed to mark job failed:", jobId, error);
    }
}
async function handleJobAttempt(jobId) {
    if (!jobId)
        return;
    // De-dupe re-entrant events
    if (inFlight.has(jobId))
        return;
    inFlight.add(jobId);
    try {
        const locked = await claimJob(jobId);
        if (!locked) {
            // Not queued, or someone else took it.
            return;
        }
        console.log("[credit-worker] processing job", jobId);
        try {
            const result = await processJob(locked);
            console.log(`[credit-worker] job ${jobId} complete -> ${result.redactedBucket}/${result.redactedPath}`);
        }
        catch (err) {
            console.error("[credit-worker] job failed:", jobId, err);
            await markFailed(jobId, err);
        }
    }
    finally {
        inFlight.delete(jobId);
    }
}
/**
 * Catch up on queued jobs (boot + periodic safety net).
 */
async function catchUpQueuedJobs() {
    lastCatchUpAt = new Date().toISOString();
    lastCatchUpError = null;
    const { data, error } = await supabase
        .from("credit_report_jobs")
        .select("id,status,applicant_role,created_at")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(CATCHUP_LIMIT);
    if (error) {
        lastCatchUpError = formatWorkerError(error);
        console.error("[credit-worker] catch-up query error:", error);
        return;
    }
    if (!data || data.length === 0) {
        return;
    }
    console.log(`[credit-worker] catch-up: found ${data.length} queued job(s)`, data.map((r) => `${r.id}:${r.applicant_role ?? "primary"}`));
    for (const row of data) {
        handleJobAttempt(row.id);
    }
}
async function startRealtimeListener() {
    console.log("[credit-worker] listening for jobs...");
    supabase
        .channel("credit-job-listener")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "credit_report_jobs" }, (payload) => {
        const job = payload.new;
        console.log("[credit-worker] RT INSERT", {
            id: job?.id,
            status: job?.status,
        });
        // Always attempt to claim on INSERT.
        // If status != queued, claimJob() will no-op safely.
        if (job?.id)
            handleJobAttempt(job.id);
    })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "credit_report_jobs" }, (payload) => {
        const job = payload.new;
        const old = payload.old;
        console.log("[credit-worker] RT UPDATE", {
            id: job?.id,
            oldStatus: old?.status,
            newStatus: job?.status,
        });
        // Only attempt claim when it becomes queued (reduces chatter)
        const becameQueued = job?.status === "queued" && old?.status !== "queued";
        if (becameQueued && job?.id)
            handleJobAttempt(job.id);
    })
        .subscribe((status) => {
        realtimeStatus = status;
        console.log("[credit-worker] realtime subscription status:", status);
    });
}
async function main() {
    startHealthServer();
    await sanityCheckDb();
    // Boot catch-up (covers downtime)
    await catchUpQueuedJobs();
    // Realtime listener (instant processing)
    await startRealtimeListener();
    // Safety net: if realtime misses events, we still process within 60s
    setInterval(() => {
        catchUpQueuedJobs();
    }, CATCHUP_INTERVAL_MS);
}
main().catch((err) => {
    console.error("[credit-worker] fatal error", err);
    process.exit(1);
});
