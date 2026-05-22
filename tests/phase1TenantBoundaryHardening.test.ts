import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath =
  "supabase/migrations/20260521031120_harden_legacy_rls_and_function_grants.sql";
const migrationSql = readRepoFile(migrationPath);
const phase1bMigrationPath =
  "supabase/migrations/20260522152654_harden_deal_structure_inputs_rls.sql";
const phase1bMigrationSql = readRepoFile(phase1bMigrationPath);
const baselineSql = readRepoFile(
  "supabase/migrations/20260409000000_baseline_existing_schema.sql"
);

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("Phase 1 RLS hardening migration only targets confirmed permissive policies", () => {
  const policyTargets = [
    ["public.deal_people", "deal_people_all_authenticated"],
    ["public.deal_people", "deal_people_insert_auth"],
    ["public.deal_people", "deal_people_select_auth"],
    ["public.deal_people", "deal_people_update_auth"],
    ["public.deals", "deals_all_authenticated"],
    ["public.deals", "deals_insert_auth"],
    ["public.deals", "deals_select_auth"],
    ["public.deals", "deals_update_auth"],
    ["public.income_profiles", "income_profiles_all_authenticated"],
    ["public.income_profiles", "income_profiles_insert_auth"],
    ["public.income_profiles", "income_profiles_select_auth"],
    ["public.income_profiles", "income_profiles_update_auth"],
  ];

  assert.match(migrationSql, /drop policy if exists %I on %s/);

  for (const [tableName, policyName] of policyTargets) {
    assert.match(
      migrationSql,
      new RegExp(`\\('${tableName}', '${policyName}'\\)`),
      `${migrationPath} should track ${policyName} on ${tableName}`
    );
  }

  const deferredPolicies = [
    "audit_log_all_authenticated",
    "deal_people_insert_anon_dev",
    "deals_insert_anon_dev",
    "documents_all_authenticated",
    "income_profiles_insert_anon_dev",
    "vehicle_options_all_authenticated",
    "vehicle_selection_all_authenticated",
  ];

  for (const policyName of deferredPolicies) {
    assert.doesNotMatch(
      migrationSql,
      new RegExp(`'${policyName}'`),
      `${migrationPath} should defer ${policyName} until live RLS validation`
    );
  }
});

test("Phase 1 dropped policies have tracked org-scoped replacements", () => {
  const replacementPolicies = [
    "deal_people_delete_active_members",
    "deal_people_insert_active_members",
    "deal_people_select_active_members",
    "deal_people_update_active_members",
    "deals_delete_active_members",
    "deals_insert_active_members",
    "deals_select_active_members",
    "deals_update_active_members",
    "income_profiles_delete_active_members",
    "income_profiles_insert_active_members",
    "income_profiles_select_active_members",
    "income_profiles_update_active_members",
  ];

  for (const policyName of replacementPolicies) {
    assert.match(
      baselineSql,
      new RegExp(`CREATE POLICY "${policyName}"`),
      `baseline schema should include ${policyName}`
    );
  }

  assert.match(
    baselineSql,
    /is_active_organization_member"\("organization_id"\)/
  );
});

test("Phase 1 function hardening leaves current deal creation RPCs untouched", () => {
  const legacyFunctions = [
    "public.atlas_dashboard_metrics()",
    "public.bhph_evaluate_bureau(uuid)",
    "public.trivian_amount_financed(numeric, boolean, boolean, numeric)",
    "public.trivian_get_config()",
    "public.trivian_inventory_pricing(numeric, integer, boolean, boolean, numeric)",
    "public.trivian_max_amount_financed(numeric, integer)",
    "public.trivian_max_payment(numeric)",
    "public.trivian_monthly_payment(numeric, integer)",
    "public.trivian_qualifying_units(numeric, integer, boolean, boolean, numeric)",
    "public.trivian_quote(numeric, numeric, integer, boolean, boolean, numeric)",
    "public.trivian_tax_amount(numeric)",
    "public.trivian_tax_amount(numeric, boolean)",
  ];

  assert.match(
    migrationSql,
    /revoke execute on function %s from public, anon, authenticated/
  );
  assert.match(
    migrationSql,
    /Direct public\/anon\/authenticated execution was revoked/
  );

  for (const functionSignature of legacyFunctions) {
    assert.match(
      migrationSql,
      new RegExp(`\\('${escapeRegExp(functionSignature)}'\\)`),
      `${migrationPath} should revoke direct execution for ${functionSignature}`
    );
  }

  assert.doesNotMatch(migrationSql, /create_deal_with_seed_data/);
});

test("Phase 1 migration does not drop legacy schema or tighten nullable org columns", () => {
  assert.doesNotMatch(migrationSql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(migrationSql, /\bdrop\s+function\b/i);
  assert.doesNotMatch(migrationSql, /\bset\s+not\s+null\b/i);
});

test("deal detail route selects only real structure primary-key columns", () => {
  const routeSource = readRepoFile("src/app/api/deals/[dealId]/route.ts");

  assert.match(
    routeSource,
    /\.from\("deal_structure"\)\s*\.select\("deal_id, vehicle_id, created_at, updated_at"\)/
  );
  assert.match(
    routeSource,
    /\.from\("deal_vehicle_selection"\)\s*\.select\(\s*"deal_id, vehicle_id, option_label, include_vsc, include_gap, term_months, monthly_payment, cash_down, created_at, updated_at"\s*\)/
  );
  assert.doesNotMatch(
    routeSource,
    /\.from\("deal_structure"\)\s*\.select\("id,/
  );
  assert.doesNotMatch(
    routeSource,
    /\.from\("deal_vehicle_selection"\)\s*\.select\(\s*"id,/
  );
});

test("Phase 1B enables deal_structure_inputs RLS with authenticated scoped policies", () => {
  assert.match(
    phase1bMigrationSql,
    /alter table public\.deal_structure_inputs enable row level security/i
  );

  for (const operation of ["select", "insert", "update", "delete"]) {
    assert.match(
      phase1bMigrationSql,
      new RegExp(
        `create policy "deal_structure_inputs_${operation}_active_members"[\\s\\S]+?for ${operation}[\\s\\S]+?to authenticated`,
        "i"
      ),
      `${phase1bMigrationPath} should create an authenticated ${operation} policy`
    );
  }

  assert.doesNotMatch(phase1bMigrationSql, /\bto\s+anon\b/i);
  assert.doesNotMatch(phase1bMigrationSql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(phase1bMigrationSql, /with\s+check\s*\(\s*true\s*\)/i);
});

test("Phase 1B deal_structure_inputs policies match parent deal and vehicle organization", () => {
  const dealOrgMatch =
    /from public\.deals d[\s\S]+?where d\.id = deal_structure_inputs\.deal_id[\s\S]+?and d\.organization_id = deal_structure_inputs\.organization_id/i;
  const vehicleOrgMatch =
    /deal_structure_inputs\.vehicle_id is null[\s\S]+?from public\.trivian_inventory v[\s\S]+?where v\.id = deal_structure_inputs\.vehicle_id[\s\S]+?and v\.organization_id = deal_structure_inputs\.organization_id/i;

  assert.match(phase1bMigrationSql, dealOrgMatch);
  assert.match(phase1bMigrationSql, vehicleOrgMatch);

  for (const operation of ["insert", "update"]) {
    const policyMatch = phase1bMigrationSql.match(
      new RegExp(
        `create policy "deal_structure_inputs_${operation}_active_members"([\\s\\S]+?)(?=drop policy|commit;)`,
        "i"
      )
    );

    assert.ok(policyMatch, `missing ${operation} policy`);
    assert.match(policyMatch[0], dealOrgMatch);
    assert.match(policyMatch[0], vehicleOrgMatch);
  }
});

test("Phase 1B migration only touches deal_structure_inputs", () => {
  const allowedTouchedRelations = new Set([
    "public.deal_structure_inputs",
    "public.deals",
    "public.trivian_inventory",
  ]);

  const relationMatches = phase1bMigrationSql.matchAll(
    /\b(?:alter table|on|from|join)\s+(public\.[a-z_]+)/gi
  );

  for (const match of relationMatches) {
    assert.ok(
      allowedTouchedRelations.has(match[1]),
      `${phase1bMigrationPath} should not touch ${match[1]}`
    );
  }

  assert.doesNotMatch(phase1bMigrationSql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(phase1bMigrationSql, /\bdrop\s+function\b/i);
  assert.doesNotMatch(phase1bMigrationSql, /\bset\s+not\s+null\b/i);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
