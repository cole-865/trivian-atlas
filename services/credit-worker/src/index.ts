import { supabase } from "./supabase.js";
import pdf from "pdf-parse";

const WORKER_ID = process.env.WORKER_ID || "credit-worker-1";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function claimJob() {
  const { data } = await supabase
    .from("credit_report_jobs")
    .select("*")
    .eq("status", "queued")
    .limit(1);

  if (!data || data.length === 0) return null;

  const job = data[0];

  await supabase
    .from("credit_report_jobs")
    .update({ status: "parsing", locked_by: WORKER_ID, locked_at: new Date().toISOString() })
    .eq("id", job.id);

  return job;
}

async function processJob(job: any) {
  try {
    const { data, error } = await supabase.storage
      .from(job.raw_bucket)
      .download(job.raw_path);

    if (error) throw error;

    const buffer = Buffer.from(await data.arrayBuffer());

    const parsed = await pdf(buffer);

    await supabase
      .from("credit_report_jobs")
      .update({
        status: "done",
        extracted_text: parsed.text,
        processed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    console.log(`Processed job ${job.id}`);
  } catch (err: any) {
    await supabase
      .from("credit_report_jobs")
      .update({
        status: "failed",
        error_message: err.message,
      })
      .eq("id", job.id);
  }
}

async function loop() {
  while (true) {
    const job = await claimJob();
    if (job) {
      await processJob(job);
    }
    await sleep(3000);
  }
}

loop();