#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const REPORT_TYPES = new Set([
  "all_accounts",
  "payment_ledger",
  "bhph_activities",
]);

function usage() {
  return `
Usage:
  npm run dms:import:local -- --report-type <type> --file <csv-path> --cookie <localhost-cookie>

Options:
  --report-type       all_accounts | payment_ledger | bhph_activities
  --file              Path to the DMS CSV export
  --cookie            Cookie header copied from an authenticated localhost Atlas request
  --url               Import endpoint base URL or full endpoint URL, defaults to http://localhost:3000
  --source-filename   Optional source filename to store on the import batch
  --allow-non-local   Required if --url is not localhost or 127.0.0.1
`.trim();
}

function parseArgs(argv) {
  const args = {
    allowNonLocal: false,
    url: "http://localhost:3000",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--allow-non-local") {
      args.allowNonLocal = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;

    if (key === "report-type") args.reportType = value;
    else if (key === "file") args.file = value;
    else if (key === "cookie") args.cookie = value;
    else if (key === "url") args.url = value;
    else if (key === "source-filename") args.sourceFilename = value;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function importEndpoint(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.pathname === "/" || parsed.pathname === "") {
    parsed.pathname = "/api/dms/import";
  }
  return parsed;
}

function isLocalUrl(url) {
  return ["localhost", "127.0.0.1"].includes(url.hostname);
}

function sanitizedSummary(summary) {
  if (!summary || typeof summary !== "object") {
    return summary;
  }

  const errors = Array.isArray(summary.errors)
    ? summary.errors.map((error) => ({
        row: error?.row ?? null,
        code: String(error?.code ?? "unknown_error"),
        message: String(error?.message ?? "Import error."),
      }))
    : [];

  return {
    ok: Boolean(summary.ok),
    batch_id: summary.batch_id ?? null,
    report_type: summary.report_type ?? null,
    source_filename: summary.source_filename ?? null,
    row_count: summary.row_count ?? 0,
    inserted: summary.inserted ?? 0,
    updated: summary.updated ?? 0,
    skipped: summary.skipped ?? 0,
    errors,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.reportType || !REPORT_TYPES.has(args.reportType)) {
    throw new Error("--report-type must be one of all_accounts, payment_ledger, bhph_activities.");
  }

  if (!args.file) {
    throw new Error("--file is required.");
  }

  if (!args.cookie) {
    throw new Error("--cookie is required.");
  }

  const endpoint = importEndpoint(args.url);
  if (!isLocalUrl(endpoint) && !args.allowNonLocal) {
    throw new Error(
      "Refusing to post DMS CSV to a non-local URL. Re-run with --allow-non-local if this is intentional."
    );
  }

  const filePath = path.resolve(args.file);
  const fileBuffer = await readFile(filePath);
  const sourceFilename = args.sourceFilename || path.basename(filePath);

  const form = new FormData();
  form.set("report_type", args.reportType);
  form.set("source_filename", sourceFilename);
  form.set(
    "file",
    new Blob([fileBuffer], { type: "text/csv" }),
    sourceFilename
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Cookie: args.cookie,
    },
    body: form,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  if (response.status === 401 || response.status === 403) {
    console.error(
      "Authentication failed. Confirm you copied the local localhost session cookie for a user with manage_integrations permission."
    );
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`Import failed with HTTP ${response.status}.`);
    if (payload) {
      console.error(JSON.stringify(sanitizedSummary(payload), null, 2));
    }
    process.exit(1);
  }

  console.log(JSON.stringify(sanitizedSummary(payload), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Local DMS import failed.");
  console.error("");
  console.error(usage());
  process.exit(1);
});
