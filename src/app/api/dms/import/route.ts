import { NextResponse } from "next/server";
import { hasDealershipPermission } from "@/lib/auth/dealershipPermissions";
import { getAuthContext } from "@/lib/auth/userRole";
import { importDmsCsv, type DmsImportSummary } from "@/lib/dms/importService";
import { isDmsReportType, type DmsReportType } from "@/lib/dms/reportTypes";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

type ParsedImportRequest = {
  reportType: unknown;
  sourceFilename: string | null;
  csvContent: string | null;
};

async function parseImportRequest(req: Request): Promise<ParsedImportRequest> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const sourceFilename = String(form.get("source_filename") ?? "").trim();

    return {
      reportType: form.get("report_type"),
      sourceFilename:
        sourceFilename ||
        (file instanceof File ? file.name : null),
      csvContent: file instanceof File ? await file.text() : null,
    };
  }

  const body = await req.json().catch(() => ({}));
  return {
    reportType: body.report_type,
    sourceFilename:
      typeof body.source_filename === "string" ? body.source_filename : null,
    csvContent:
      typeof body.csv_content === "string" ? body.csv_content : null,
  };
}

function failedImportSummary(args: {
  reportType: DmsReportType;
  sourceFilename: string | null;
  code: string;
  message: string;
}): DmsImportSummary {
  return {
    ok: false,
    batch_id: null,
    report_type: args.reportType,
    source_filename: args.sourceFilename,
    row_count: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [
      {
        row: null,
        code: args.code,
        message: args.message,
      },
    ],
  };
}

function logDmsImportFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown DMS import error.";
  // Do not log request bodies, raw CSV rows, cookies, or raw_data here.
  console.error("[dms-import] unexpected import failure:", message);
}

export async function POST(req: Request) {
  const sessionClient = await supabaseServer();
  const auth = await sessionClient.auth.getUser();

  if (auth.error || !auth.data.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authContext = await getAuthContext(sessionClient);
  const organizationId = authContext.currentOrganizationId;

  if (!organizationId) {
    return NextResponse.json(
      { error: "No active organization is selected for this user." },
      { status: 400 }
    );
  }

  if (!(await hasDealershipPermission(authContext, "manage_integrations"))) {
    return NextResponse.json(
      { error: "DMS imports require integration management permission." },
      { status: 403 }
    );
  }

  let parsed: ParsedImportRequest;
  try {
    parsed = await parseImportRequest(req);
  } catch {
    return NextResponse.json({ error: "Invalid import request." }, { status: 400 });
  }

  if (!isDmsReportType(parsed.reportType)) {
    return NextResponse.json({ error: "Invalid report_type." }, { status: 400 });
  }

  if (!parsed.csvContent?.trim()) {
    return NextResponse.json(
      { error: "CSV content is required." },
      { status: 400 }
    );
  }

  let summary: DmsImportSummary;
  try {
    const admin = createAdminClient();
    summary = await importDmsCsv({
      supabase: admin,
      organizationId,
      importedByUserId: auth.data.user.id,
      reportType: parsed.reportType,
      sourceFilename: parsed.sourceFilename,
      csvContent: parsed.csvContent,
    });
  } catch (error) {
    logDmsImportFailure(error);

    const adminClientUnavailable =
      error instanceof Error && error.message.includes("SUPABASE_SERVICE_ROLE_KEY");

    return NextResponse.json(
      failedImportSummary({
        reportType: parsed.reportType,
        sourceFilename: parsed.sourceFilename,
        code: adminClientUnavailable ? "admin_client_unavailable" : "import_failed",
        message: adminClientUnavailable
          ? "DMS import service is not configured. Confirm local Supabase service role env vars are set and restart the dev server."
          : "DMS import failed unexpectedly. Check the local Next.js dev server logs for sanitized details.",
      }),
      { status: 500 }
    );
  }

  return NextResponse.json(summary, { status: summary.ok ? 200 : 400 });
}
