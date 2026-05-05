import test from "node:test";
import assert from "node:assert/strict";
import { handleDmsImportPost } from "../src/lib/dms/importRouteHandler.js";
import type { AuthContext } from "../src/lib/auth/userRole.js";

function jsonRequest(body: Record<string, unknown>, token?: string) {
  return new Request("http://localhost/api/dms/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function minimalCsv() {
  return "Deal Number,Account Status\nA-100,Active\n";
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function adminClient(args?: { organizationExists?: boolean }) {
  const organizationExists = args?.organizationExists ?? true;
  return {
    from(table: string) {
      assert.equal(table, "organizations");
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: organizationExists ? { id: "org-1" } : null,
                      error: null,
                    }),
                  };
                },
                maybeSingle: async () => ({
                  data: organizationExists ? { id: "org-1" } : null,
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
}

function importSummary() {
  return {
    ok: true,
    batch_id: "batch-1",
    report_type: "all_accounts" as const,
    source_filename: "accounts.csv",
    row_count: 1,
    inserted: 1,
    updated: 0,
    skipped: 0,
    errors: [],
  };
}

function authContext(overrides?: Partial<AuthContext>): AuthContext {
  return {
    realUser: null,
    realProfile: null,
    realRole: null,
    realOrganizationMembership: null,
    realOrganizationRole: null,
    effectiveProfile: null,
    effectiveRole: null,
    effectiveOrganizationMembership: null,
    effectiveOrganizationRole: null,
    isImpersonating: false,
    impersonatedProfile: null,
    impersonatedUserId: null,
    availableOrganizationMemberships: [],
    currentOrganization: null,
    currentOrganizationId: "11111111-1111-4111-8111-111111111111",
    currentOrganizationMembership: null,
    ...overrides,
  };
}

test("DMS service-token auth is disabled when env token is missing", async () => {
  const response = await handleDmsImportPost(
    jsonRequest(
      {
        report_type: "all_accounts",
        organization_id: "11111111-1111-4111-8111-111111111111",
        csv_content: minimalCsv(),
      },
      "secret"
    ),
    {
      getDmsImportToken: () => undefined,
      logError: () => undefined,
    }
  );
  const body = await responseJson(response);

  assert.equal(response.status, 401);
  assert.equal(body.error, "DMS import service-token auth is disabled.");
});

test("DMS service-token auth rejects invalid token", async () => {
  const response = await handleDmsImportPost(
    jsonRequest(
      {
        report_type: "all_accounts",
        organization_id: "11111111-1111-4111-8111-111111111111",
        csv_content: minimalCsv(),
      },
      "wrong"
    ),
    {
      getDmsImportToken: () => "correct-token",
      logError: () => undefined,
    }
  );
  const body = await responseJson(response);

  assert.equal(response.status, 401);
  assert.equal(body.error, "Invalid DMS import service token.");
});

test("DMS service-token auth requires organization_id", async () => {
  const response = await handleDmsImportPost(
    jsonRequest(
      {
        report_type: "all_accounts",
        csv_content: minimalCsv(),
      },
      "correct-token"
    ),
    {
      getDmsImportToken: () => "correct-token",
      logError: () => undefined,
    }
  );
  const body = await responseJson(response);

  assert.equal(response.status, 400);
  assert.equal(body.error, "organization_id is required for service-token DMS imports.");
});

test("DMS service-token auth imports with valid token and organization_id", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleDmsImportPost(
    jsonRequest(
      {
        report_type: "all_accounts",
        organization_id: "11111111-1111-4111-8111-111111111111",
        source_filename: "accounts.csv",
        csv_content: minimalCsv(),
      },
      "correct-token"
    ),
    {
      getDmsImportToken: () => "correct-token",
      createAdminClient: () => adminClient(),
      importDmsCsv: async (input) => {
        calls.push({
          organizationId: input.organizationId,
          importedByUserId: input.importedByUserId,
          reportType: input.reportType,
        });
        return importSummary();
      },
      logError: () => undefined,
    }
  );
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    {
      organizationId: "11111111-1111-4111-8111-111111111111",
      importedByUserId: null,
      reportType: "all_accounts",
    },
  ]);
  assert.equal("raw_data" in body, false);
});

test("DMS session auth path still imports with current organization and user", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleDmsImportPost(
    jsonRequest({
      report_type: "all_accounts",
      source_filename: "accounts.csv",
      csv_content: minimalCsv(),
    }),
    {
      getSessionClient: async () => ({
        auth: {
          getUser: async () => ({
            data: {
              user: {
                id: "user-1",
                app_metadata: {},
                user_metadata: {},
                aud: "authenticated",
                created_at: "2026-05-05T00:00:00.000Z",
              },
            },
            error: null,
          }),
        },
      }),
      getAuthContext: async () =>
        authContext({
          currentOrganizationId: "11111111-1111-4111-8111-111111111111",
        }),
      hasDealershipPermission: async () => true,
      createAdminClient: () => adminClient(),
      importDmsCsv: async (input) => {
        calls.push({
          organizationId: input.organizationId,
          importedByUserId: input.importedByUserId,
          reportType: input.reportType,
        });
        return importSummary();
      },
      logError: () => undefined,
    }
  );
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    {
      organizationId: "11111111-1111-4111-8111-111111111111",
      importedByUserId: "user-1",
      reportType: "all_accounts",
    },
  ]);
  assert.equal("raw_data" in body, false);
});
