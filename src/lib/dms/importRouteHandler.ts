import { timingSafeEqual } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { AuthContext } from "../auth/userRole";
import { importDmsCsv, type DmsImportSummary } from "./importService";
import { isDmsReportType, type DmsReportType } from "./reportTypes";

type ParsedImportRequest = {
  reportType: unknown;
  organizationId: string | null;
  sourceFilename: string | null;
  csvContent: string | null;
};

type AuthUserResult = {
  data: { user: User | null };
  error?: { message: string } | null;
};

type SessionClient = {
  auth: {
    getUser: () => Promise<AuthUserResult>;
  };
};

type AdminClient = { from: (table: string) => unknown };
type OrganizationLookupQuery = {
  select: (columns: string) => {
    eq: (
      column: string,
      value: unknown
    ) => {
      eq: (
        column: string,
        value: unknown
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};
type ImportDmsCsvFn = (input: Parameters<typeof importDmsCsv>[0]) => ReturnType<typeof importDmsCsv>;

export type DmsImportRouteDeps = {
  getSessionClient?: () => Promise<SessionClient>;
  getAuthContext?: (sessionClient: SessionClient) => Promise<AuthContext>;
  hasDealershipPermission?: (
    authContext: AuthContext,
    permission: "manage_integrations"
  ) => Promise<boolean>;
  createAdminClient?: () => AdminClient;
  importDmsCsv?: ImportDmsCsvFn;
  getDmsImportToken?: () => string | undefined;
  logError?: (error: unknown) => void;
};

type ResolvedDmsImportRouteDeps = {
  getSessionClient: () => Promise<SessionClient>;
  getAuthContext: (sessionClient: SessionClient) => Promise<AuthContext>;
  hasDealershipPermission: (
    authContext: AuthContext,
    permission: "manage_integrations"
  ) => Promise<boolean>;
  createAdminClient: () => AdminClient;
  importDmsCsv: ImportDmsCsvFn;
  getDmsImportToken: () => string | undefined;
  logError: (error: unknown) => void;
};

type ImportAuthResolution =
  | { response: Response }
  | {
      admin: AdminClient;
      organizationId: string;
      importedByUserId: string | null;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status: number) {
  return Response.json(body, { status });
}

function hasAuthorizationHeader(req: Request) {
  return !!req.headers.get("authorization")?.trim();
}

function parseBearerToken(req: Request) {
  const authorization = req.headers.get("authorization")?.trim() ?? "";
  const match = /^bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  const length = Math.max(leftBuffer.length, rightBuffer.length, 1);
  const paddedLeft = Buffer.alloc(length);
  const paddedRight = Buffer.alloc(length);

  leftBuffer.copy(paddedLeft);
  rightBuffer.copy(paddedRight);

  return (
    timingSafeEqual(paddedLeft, paddedRight) &&
    leftBuffer.length === rightBuffer.length
  );
}

function isValidServiceToken(args: {
  providedToken: string | null;
  configuredToken: string | undefined;
}) {
  if (!args.configuredToken) {
    return { ok: false, code: "service_auth_disabled" as const };
  }

  if (
    !args.providedToken ||
    !timingSafeStringEqual(args.providedToken, args.configuredToken)
  ) {
    return { ok: false, code: "invalid_service_token" as const };
  }

  return { ok: true, code: null };
}

async function parseImportRequest(req: Request): Promise<ParsedImportRequest> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const sourceFilename = String(form.get("source_filename") ?? "").trim();
    const organizationId = String(form.get("organization_id") ?? "").trim();

    return {
      reportType: form.get("report_type"),
      organizationId: organizationId || null,
      sourceFilename:
        sourceFilename ||
        (file instanceof File ? file.name : null),
      csvContent: file instanceof File ? await file.text() : null,
    };
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    reportType: body.report_type,
    organizationId:
      typeof body.organization_id === "string" ? body.organization_id : null,
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

function defaultLogDmsImportFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown DMS import error.";
  // Do not log request bodies, raw CSV rows, cookies, tokens, or raw_data here.
  console.error("[dms-import] unexpected import failure:", message);
}

async function requireActiveOrganization(args: {
  admin: AdminClient;
  organizationId: string;
}) {
  const query = args.admin.from("organizations") as OrganizationLookupQuery;
  const { data, error } = await query
    .select("id")
    .eq("id", args.organizationId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to validate organization: ${error.message}`);
  }

  return !!data;
}

function normalizeOrganizationId(value: string | null) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

async function resolveServiceAuth(args: {
  req: Request;
  parsed: ParsedImportRequest;
  deps: ResolvedDmsImportRouteDeps;
}): Promise<ImportAuthResolution> {
  const tokenCheck = isValidServiceToken({
    providedToken: parseBearerToken(args.req),
    configuredToken: args.deps.getDmsImportToken(),
  });

  if (!tokenCheck.ok) {
    const message =
      tokenCheck.code === "service_auth_disabled"
        ? "DMS import service-token auth is disabled."
        : "Invalid DMS import service token.";
    return { response: jsonResponse({ error: message }, 401) };
  }

  const organizationId = normalizeOrganizationId(args.parsed.organizationId);
  if (!organizationId) {
    return {
      response: jsonResponse(
        { error: "organization_id is required for service-token DMS imports." },
        400
      ),
    };
  }

  if (!UUID_PATTERN.test(organizationId)) {
    return {
      response: jsonResponse(
        { error: "organization_id must be a valid UUID." },
        400
      ),
    };
  }

  const admin = args.deps.createAdminClient();
  const organizationExists = await requireActiveOrganization({ admin, organizationId });
  if (!organizationExists) {
    return {
      response: jsonResponse(
        { error: "organization_id does not reference an active organization." },
        400
      ),
    };
  }

  return {
    admin,
    organizationId,
    importedByUserId: null,
  };
}

async function resolveSessionAuth(args: {
  deps: ResolvedDmsImportRouteDeps;
}): Promise<ImportAuthResolution> {
  const sessionClient = await args.deps.getSessionClient();
  const auth = await sessionClient.auth.getUser();

  if (auth.error || !auth.data.user) {
    return { response: jsonResponse({ error: "Unauthorized" }, 401) };
  }

  const authContext = await args.deps.getAuthContext(sessionClient);
  const organizationId = authContext.currentOrganizationId;

  if (!organizationId) {
    return {
      response: jsonResponse(
        { error: "No active organization is selected for this user." },
        400
      ),
    };
  }

  if (!(await args.deps.hasDealershipPermission(authContext, "manage_integrations"))) {
    return {
      response: jsonResponse(
        { error: "DMS imports require integration management permission." },
        403
      ),
    };
  }

  return {
    admin: args.deps.createAdminClient(),
    organizationId,
    importedByUserId: auth.data.user.id,
  };
}

function withDefaults(deps: DmsImportRouteDeps): ResolvedDmsImportRouteDeps {
  return {
    getSessionClient:
      deps.getSessionClient ??
      (async () => {
        throw new Error("DMS import session auth dependency is not configured.");
      }),
    getAuthContext:
      deps.getAuthContext ??
      (async () => {
        throw new Error("DMS import auth context dependency is not configured.");
      }),
    hasDealershipPermission:
      deps.hasDealershipPermission ??
      (async () => {
        throw new Error("DMS import permission dependency is not configured.");
      }),
    createAdminClient:
      deps.createAdminClient ??
      (() => {
        throw new Error("DMS import admin client dependency is not configured.");
      }),
    importDmsCsv: deps.importDmsCsv ?? importDmsCsv,
    getDmsImportToken:
      deps.getDmsImportToken ?? (() => process.env.DMS_IMPORT_TOKEN),
    logError: deps.logError ?? defaultLogDmsImportFailure,
  };
}

export async function handleDmsImportPost(
  req: Request,
  deps: DmsImportRouteDeps = {}
) {
  const resolvedDeps = withDefaults(deps);
  let parsed: ParsedImportRequest;

  try {
    parsed = await parseImportRequest(req);
  } catch {
    return jsonResponse({ error: "Invalid import request." }, 400);
  }

  if (!isDmsReportType(parsed.reportType)) {
    return jsonResponse({ error: "Invalid report_type." }, 400);
  }

  if (!parsed.csvContent?.trim()) {
    return jsonResponse({ error: "CSV content is required." }, 400);
  }

  try {
    const authResult = hasAuthorizationHeader(req)
      ? await resolveServiceAuth({ req, parsed, deps: resolvedDeps })
      : await resolveSessionAuth({ deps: resolvedDeps });

    if ("response" in authResult) {
      return authResult.response;
    }

    const summary = await resolvedDeps.importDmsCsv({
      supabase: authResult.admin,
      organizationId: authResult.organizationId,
      importedByUserId: authResult.importedByUserId,
      reportType: parsed.reportType,
      sourceFilename: parsed.sourceFilename,
      csvContent: parsed.csvContent,
    });

    return jsonResponse(summary, summary.ok ? 200 : 400);
  } catch (error) {
    resolvedDeps.logError(error);

    const adminClientUnavailable =
      error instanceof Error && error.message.includes("SUPABASE_SERVICE_ROLE_KEY");

    return jsonResponse(
      failedImportSummary({
        reportType: parsed.reportType,
        sourceFilename: parsed.sourceFilename,
        code: adminClientUnavailable ? "admin_client_unavailable" : "import_failed",
        message: adminClientUnavailable
          ? "DMS import service is not configured. Confirm Supabase service role env vars are set."
          : "DMS import failed unexpectedly. Check server logs for sanitized details.",
      }),
      500
    );
  }
}
