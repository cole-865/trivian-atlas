import { parseDmsCsv } from "./csv";
import { mapDmsRow } from "./mappers";
import {
  REPORT_JOIN_HEADER,
  isDmsReportType,
  validateRequiredHeaders,
  type DmsReportType,
} from "./reportTypes";

type DbError = { message: string } | null;
type DbResult<T = unknown> = { data?: T | null; error?: DbError };
type DmsQueryBuilder = {
  insert: (payload: unknown) => DmsQueryBuilder;
  update: (payload: unknown) => DmsQueryBuilder;
  upsert: (
    payload: unknown,
    options: { onConflict: string }
  ) => Promise<DbResult>;
  select: (columns: string) => DmsQueryBuilder;
  single: () => Promise<DbResult<{ id?: unknown }>>;
  eq: (column: string, value: unknown) => DmsQueryBuilder;
  in: (column: string, values: string[]) => Promise<DbResult<unknown[]>>;
};

export type DmsSupabaseClient = {
  from: (table: string) => unknown;
};

function fromTable(supabase: DmsSupabaseClient, table: string) {
  return supabase.from(table) as DmsQueryBuilder;
}

export type DmsImportInput = {
  supabase: DmsSupabaseClient;
  organizationId: string;
  importedByUserId: string | null;
  reportType: DmsReportType;
  sourceFilename?: string | null;
  csvContent: string;
};

export type DmsImportSummary = {
  ok: boolean;
  batch_id: string | null;
  report_type: DmsReportType;
  source_filename: string | null;
  row_count: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number | null; code: string; message: string }>;
};

const TARGET_TABLE: Record<DmsReportType, string> = {
  all_accounts: "dms_accounts_snapshot",
  payment_ledger: "dms_payment_ledger",
  bhph_activities: "dms_activity_events",
};

const CONFLICT_TARGET: Record<DmsReportType, string> = {
  all_accounts: "import_batch_id,deal_number",
  payment_ledger: "organization_id,transaction_hash",
  bhph_activities: "organization_id,event_hash",
};

const UNIQUE_FIELD: Record<DmsReportType, string> = {
  all_accounts: "deal_number",
  payment_ledger: "transaction_hash",
  bhph_activities: "event_hash",
};

const EXISTING_KEY_LOOKUP_CHUNK_SIZE = 100;

function safeSourceFilename(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.slice(0, 255) : null;
}

function uniqueKeyForRecord(reportType: DmsReportType, record: Record<string, unknown>) {
  if (reportType === "all_accounts") return String(record.deal_number ?? "");
  if (reportType === "payment_ledger") return String(record.transaction_hash ?? "");
  return String(record.event_hash ?? "");
}

async function createPendingBatch(args: {
  supabase: DmsSupabaseClient;
  organizationId: string;
  importedByUserId: string | null;
  reportType: DmsReportType;
  sourceFilename: string | null;
  headers: string[];
}) {
  const { data, error } = await fromTable(args.supabase, "dms_import_batches")
    .insert({
      organization_id: args.organizationId,
      report_type: args.reportType,
      source_filename: args.sourceFilename,
      source_headers: args.headers,
      imported_by_user_id: args.importedByUserId,
      status: "pending",
      raw_metadata: {
        parser: "csv-parse",
        importer: "atlas_dms_import_v1",
      },
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? "Failed to create DMS import batch.");
  }

  return String(data.id);
}

async function updateBatch(args: {
  supabase: DmsSupabaseClient;
  batchId: string;
  status: "completed" | "failed";
  rowCount: number;
  notes?: string | null;
}) {
  const result = (await fromTable(args.supabase, "dms_import_batches")
    .update({
      status: args.status,
      row_count: args.rowCount,
      notes: args.notes ?? null,
    })
    .eq("id", args.batchId)) as DbResult;

  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function loadExistingKeys(args: {
  supabase: DmsSupabaseClient;
  reportType: DmsReportType;
  organizationId: string;
  keys: string[];
}) {
  if (!args.keys.length || args.reportType === "all_accounts") {
    return new Set<string>();
  }

  const field = UNIQUE_FIELD[args.reportType];
  const found = new Set<string>();

  for (let index = 0; index < args.keys.length; index += EXISTING_KEY_LOOKUP_CHUNK_SIZE) {
    const chunk = args.keys.slice(index, index + EXISTING_KEY_LOOKUP_CHUNK_SIZE);
    const { data, error } = await fromTable(args.supabase, TARGET_TABLE[args.reportType])
      .select(field)
      .eq("organization_id", args.organizationId)
      .in(field, chunk);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const key = String(row[field] ?? "");
      if (key) {
        found.add(key);
      }
    }
  }

  return found;
}

export async function importDmsCsv(input: DmsImportInput): Promise<DmsImportSummary> {
  if (!isDmsReportType(input.reportType)) {
    throw new Error("Invalid DMS report type.");
  }

  const sourceFilename = safeSourceFilename(input.sourceFilename);
  const parsed = parseDmsCsv(input.csvContent);
  const requiredHeaders = validateRequiredHeaders({
    reportType: input.reportType,
    headers: parsed.headers,
  });

  if (!requiredHeaders.ok) {
    return {
      ok: false,
      batch_id: null,
      report_type: input.reportType,
      source_filename: sourceFilename,
      row_count: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: requiredHeaders.missing.map((header) => ({
        row: null,
        code: "missing_required_header",
        message: `Missing required header: ${header}`,
      })),
    };
  }

  const batchId = await createPendingBatch({
    supabase: input.supabase,
    organizationId: input.organizationId,
    importedByUserId: input.importedByUserId,
    reportType: input.reportType,
    sourceFilename,
    headers: parsed.headers,
  });

  const joinHeader = REPORT_JOIN_HEADER[input.reportType];
  const errors: DmsImportSummary["errors"] = [];
  const recordsByKey = new Map<string, Record<string, unknown>>();
  let skipped = 0;

  for (const [index, row] of parsed.rows.entries()) {
    if (!String(row[joinHeader] ?? "").trim()) {
      skipped += 1;
      errors.push({
        row: index + 2,
        code: "missing_deal_number",
        message: `Skipped row with blank ${joinHeader}.`,
      });
      continue;
    }

    const mapped = mapDmsRow({
      reportType: input.reportType,
      organizationId: input.organizationId,
      importBatchId: batchId,
      row,
    });

    if (!mapped) {
      skipped += 1;
      errors.push({
        row: index + 2,
        code: "unmapped_row",
        message: "Skipped row that could not be mapped.",
      });
      continue;
    }

    const key = uniqueKeyForRecord(input.reportType, mapped);
    if (!key) {
      skipped += 1;
      errors.push({
        row: index + 2,
        code: "missing_unique_key",
        message: "Skipped row with blank unique import key.",
      });
      continue;
    }

    if (recordsByKey.has(key)) {
      skipped += 1;
      errors.push({
        row: index + 2,
        code: "duplicate_in_file",
        message: "Duplicate unique key in file; last row wins.",
      });
    }
    recordsByKey.set(key, mapped);
  }

  const records = Array.from(recordsByKey.values());

  try {
    const keys = records.map((record) => uniqueKeyForRecord(input.reportType, record));
    const existingKeys = await loadExistingKeys({
      supabase: input.supabase,
      reportType: input.reportType,
      organizationId: input.organizationId,
      keys,
    });
    const updated = keys.filter((key) => existingKeys.has(key)).length;
    const inserted = records.length - updated;

    if (records.length) {
      const { error } = await fromTable(input.supabase, TARGET_TABLE[input.reportType])
        .upsert(records, { onConflict: CONFLICT_TARGET[input.reportType] });

      if (error) {
        throw new Error(error.message);
      }
    }

    await updateBatch({
      supabase: input.supabase,
      batchId,
      status: "completed",
      rowCount: records.length,
      notes: errors.length ? `${errors.length} rows skipped or deduplicated.` : null,
    });

    return {
      ok: true,
      batch_id: batchId,
      report_type: input.reportType,
      source_filename: sourceFilename,
      row_count: records.length,
      inserted,
      updated,
      skipped,
      errors,
    };
  } catch (error) {
    await updateBatch({
      supabase: input.supabase,
      batchId,
      status: "failed",
      rowCount: records.length,
      notes: "DMS import failed during upsert.",
    });

    return {
      ok: false,
      batch_id: batchId,
      report_type: input.reportType,
      source_filename: sourceFilename,
      row_count: records.length,
      inserted: 0,
      updated: 0,
      skipped,
      errors: [
        ...errors,
        {
          row: null,
          code: "import_failed",
          message: error instanceof Error ? error.message : "DMS import failed.",
        },
      ],
    };
  }
}

// Future n8n integration should call this same service after a separate,
// explicit service-token authorization boundary resolves organizationId.
