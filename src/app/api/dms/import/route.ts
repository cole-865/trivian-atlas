import { NextResponse } from "next/server";
import { hasDealershipPermission } from "@/lib/auth/dealershipPermissions";
import { getAuthContext } from "@/lib/auth/userRole";
import { importDmsCsv } from "@/lib/dms/importService";
import { isDmsReportType } from "@/lib/dms/reportTypes";
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

  const admin = createAdminClient();
  const summary = await importDmsCsv({
    supabase: admin,
    organizationId,
    importedByUserId: auth.data.user.id,
    reportType: parsed.reportType,
    sourceFilename: parsed.sourceFilename,
    csvContent: parsed.csvContent,
  });

  return NextResponse.json(summary, { status: summary.ok ? 200 : 400 });
}
