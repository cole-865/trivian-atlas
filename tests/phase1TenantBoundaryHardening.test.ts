import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath =
  "supabase/migrations/20260521031120_harden_legacy_rls_and_function_grants.sql";
const migrationSql = readRepoFile(migrationPath);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
