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
const phase2MigrationPath =
  "supabase/migrations/20260601023230_phase2_harden_legacy_rls_surfaces.sql";
const phase2MigrationSql = readRepoFile(phase2MigrationPath);
const phase3aMigrationPath =
  "supabase/migrations/20260601034246_phase3a_remove_global_settings_fallbacks.sql";
const phase3aMigrationSql = readRepoFile(phase3aMigrationPath);
const phase3bMigrationPath =
  "supabase/migrations/20260602023832_phase3b_tighten_identity_settings_rls.sql";
const phase3bMigrationSql = readRepoFile(phase3bMigrationPath);
const phase3cAMigrationPath =
  "supabase/migrations/20260602033237_phase3c_a_remove_broad_anon_access.sql";
const phase3cAMigrationSql = readRepoFile(phase3cAMigrationPath);
const phase3cBMigrationPath =
  "supabase/migrations/20260603011538_phase3c_b_stamp_seeded_deal_children_org.sql";
const phase3cBMigrationSql = readRepoFile(phase3cBMigrationPath);
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

test("Phase 2 hardens only approved legacy RLS surfaces", () => {
  const approvedTables = [
    "public.deal_management_notes",
    "public.bhph_bureau_rules",
    "public.documents",
    "public.vehicle_options",
    "public.vehicle_selection",
  ];

  for (const tableName of approvedTables) {
    assert.match(
      phase2MigrationSql,
      new RegExp(escapeRegExp(tableName)),
      `${phase2MigrationPath} should touch ${tableName}`
    );
  }

  assert.match(
    phase2MigrationSql,
    /alter table public\.deal_management_notes enable row level security/i
  );
  assert.match(
    phase2MigrationSql,
    /alter table public\.bhph_bureau_rules enable row level security/i
  );

  for (const policyName of [
    "documents_all_authenticated",
    "vehicle_options_all_authenticated",
    "vehicle_selection_all_authenticated",
  ]) {
    assert.match(
      phase2MigrationSql,
      new RegExp(`drop policy if exists "${policyName}"`, "i"),
      `${phase2MigrationPath} should drop ${policyName}`
    );
  }

  assert.doesNotMatch(phase2MigrationSql, /\busing\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(phase2MigrationSql, /\bwith\s+check\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(phase2MigrationSql, /\bto\s+anon\b/i);
  assert.doesNotMatch(phase2MigrationSql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(phase2MigrationSql, /\bdrop\s+function\b/i);
  assert.doesNotMatch(phase2MigrationSql, /\bset\s+not\s+null\b/i);
});

test("Phase 2 legacy deal-child policies require active parent deal membership", () => {
  const policyTables = [
    "deal_management_notes",
    "documents",
    "vehicle_options",
    "vehicle_selection",
  ];

  for (const tableName of policyTables) {
    assert.match(
      phase2MigrationSql,
      new RegExp(
        `from public\\.deals d[\\s\\S]+?where d\\.id = ${tableName}\\.deal_id[\\s\\S]+?d\\.organization_id is not null[\\s\\S]+?public\\.is_active_organization_member\\(d\\.organization_id\\)`,
        "i"
      ),
      `${phase2MigrationPath} should scope ${tableName} through parent deal organization`
    );
  }

  assert.match(
    phase2MigrationSql,
    /from public\.vehicle_options vo[\s\S]+?where vo\.id = vehicle_selection\.vehicle_option_id[\s\S]+?and vo\.deal_id = vehicle_selection\.deal_id/i
  );
});

test("Phase 2 bhph_bureau_rules is platform-dev only", () => {
  for (const operation of ["select", "insert", "update", "delete"]) {
    assert.match(
      phase2MigrationSql,
      new RegExp(
        `create policy "bhph_bureau_rules_${operation}_platform_dev"[\\s\\S]+?for ${operation}[\\s\\S]+?to authenticated[\\s\\S]+?\\(select public\\.current_app_role\\(\\)\\) = 'dev'`,
        "i"
      ),
      `${phase2MigrationPath} should restrict ${operation} to platform dev`
    );
  }
});

test("Phase 2 migration does not touch active global or user-scoped tables", () => {
  const blockedTables = [
    "public.app_settings",
    "public.organizations",
    "public.profiles",
    "public.user_profiles",
    "public.organization_settings",
    "public.deal_documents",
    "public.deal_structure_inputs",
  ];

  for (const tableName of blockedTables) {
    assert.doesNotMatch(
      phase2MigrationSql,
      new RegExp(escapeRegExp(tableName)),
      `${phase2MigrationPath} should not touch ${tableName}`
    );
  }
});

test("Phase 3A backfills org settings before tightening global fallback policies", () => {
  assert.match(
    phase3aMigrationSql,
    /insert into public\.organization_settings[\s\S]+?'workflow'/i
  );
  assert.match(
    phase3aMigrationSql,
    /from public\.organizations org[\s\S]+?where org\.is_active = true[\s\S]+?existing_workflow\.organization_id is null/i
  );
  assert.match(
    phase3aMigrationSql,
    /insert into public\.trivian_config[\s\S]+?organization_id[\s\S]+?from public\.organizations org[\s\S]+?where org\.is_active = true[\s\S]+?existing_config\.organization_id is null/i
  );
  assert.match(
    phase3aMigrationSql,
    /from public\.trivian_config[\s\S]+?where organization_id is null[\s\S]+?order by created_at desc[\s\S]+?limit 1/i
  );
});

test("Phase 3A removes broad app_settings and global trivian_config access", () => {
  for (const policyName of [
    "authenticated users can read app settings",
    "admin and dev can insert app settings",
    "admin and dev can update app settings",
    "config_read",
    "config_update",
    "trivian_config_select_active_members",
  ]) {
    assert.match(
      phase3aMigrationSql,
      new RegExp(`drop policy if exists "${escapeRegExp(policyName)}"`, "i"),
      `${phase3aMigrationPath} should drop ${policyName}`
    );
  }

  for (const operation of ["select", "insert", "update", "delete"]) {
    assert.match(
      phase3aMigrationSql,
      new RegExp(
        `create policy "app_settings_${operation}_platform_dev"[\\s\\S]+?for ${operation}[\\s\\S]+?to authenticated[\\s\\S]+?\\(select public\\.current_app_role\\(\\)\\) = 'dev'`,
        "i"
      )
    );
  }

  assert.match(
    phase3aMigrationSql,
    /create policy "trivian_config_select_active_members"[\s\S]+?organization_id is not null[\s\S]+?public\.is_active_organization_member\(organization_id\)/i
  );
  assert.doesNotMatch(phase3aMigrationSql, /\busing\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(phase3aMigrationSql, /\bwith\s+check\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(phase3aMigrationSql, /\bto\s+anon\b/i);
  assert.doesNotMatch(phase3aMigrationSql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(phase3aMigrationSql, /\bdrop\s+function\b/i);
  assert.doesNotMatch(phase3aMigrationSql, /\bset\s+not\s+null\b/i);
});

test("Phase 3A removes app/global fallback code paths", () => {
  const appSettingsSource = readRepoFile("src/lib/settings/appSettings.ts");
  const organizationScopeSource = readRepoFile("src/lib/los/organizationScope.ts");

  assert.doesNotMatch(appSettingsSource, /\.from\("app_settings"\)/);
  assert.match(
    appSettingsSource,
    /throw new Error\("Select an account before changing workflow settings\."\)/
  );
  assert.doesNotMatch(organizationScopeSource, /\.is\("organization_id", null\)/);
  assert.doesNotMatch(
    organizationScopeSource,
    /global\/default rows|organization_id is null/i
  );
});

test("Phase 3B revokes anon and browser-write access on identity settings surfaces", () => {
  const tables = [
    "app_settings",
    "trivian_config",
    "organizations",
    "profiles",
    "user_profiles",
  ];

  for (const table of tables) {
    assert.match(
      phase3bMigrationSql,
      new RegExp(`revoke all on table public\\.${table} from anon`, "i"),
      `${phase3bMigrationPath} should revoke anon access on ${table}`
    );
    assert.match(
      phase3bMigrationSql,
      new RegExp(
        `revoke insert, update, delete, truncate, references, trigger\\s+on table public\\.${table}\\s+from authenticated`,
        "i"
      ),
      `${phase3bMigrationPath} should remove authenticated writes on ${table}`
    );
    assert.match(
      phase3bMigrationSql,
      new RegExp(`grant select on table public\\.${table} to authenticated`, "i"),
      `${phase3bMigrationPath} should preserve authenticated reads on ${table}`
    );
  }
});

test("Phase 3B narrows legacy profile and user profile policies", () => {
  for (const policyName of [
    "Admins can read all profiles",
    "Users can read own profile",
    "admin and dev can insert user profiles",
    "admin and dev can read all user profiles",
    "admin and dev can update user profiles",
    "users can read own user profile",
  ]) {
    assert.match(
      phase3bMigrationSql,
      new RegExp(`drop policy if exists "${escapeRegExp(policyName)}"`, "i"),
      `${phase3bMigrationPath} should drop ${policyName}`
    );
  }

  assert.match(
    phase3bMigrationSql,
    /create policy "profiles_select_own"[\s\S]+?for select[\s\S]+?to authenticated[\s\S]+?user_id = auth\.uid\(\)/i
  );
  assert.match(
    phase3bMigrationSql,
    /create policy "user_profiles_select_own"[\s\S]+?for select[\s\S]+?to authenticated[\s\S]+?id = auth\.uid\(\)/i
  );
  assert.match(
    phase3bMigrationSql,
    /create policy "user_profiles_select_platform_dev"[\s\S]+?for select[\s\S]+?to authenticated[\s\S]+?\(select public\.current_app_role\(\)\) = 'dev'/i
  );
  assert.doesNotMatch(phase3bMigrationSql, /current_app_role\(\) = any \(array\['admin'.*'dev'/i);
  assert.doesNotMatch(phase3bMigrationSql, /\bto\s+anon\b/i);
});

test("Phase 3B removes direct trivian_config writes without data or table changes", () => {
  for (const policyName of [
    "trivian_config_insert_active_members",
    "trivian_config_update_active_members",
    "trivian_config_delete_active_members",
  ]) {
    assert.match(
      phase3bMigrationSql,
      new RegExp(`drop policy if exists "${policyName}"`, "i"),
      `${phase3bMigrationPath} should drop ${policyName}`
    );
  }

  assert.doesNotMatch(phase3bMigrationSql, /\busing\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(phase3bMigrationSql, /\bwith\s+check\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(phase3bMigrationSql, /\binsert\s+into\b/i);
  assert.doesNotMatch(phase3bMigrationSql, /\bupdate\s+public\./i);
  assert.doesNotMatch(phase3bMigrationSql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(phase3bMigrationSql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(phase3bMigrationSql, /\bdrop\s+function\b/i);
  assert.doesNotMatch(phase3bMigrationSql, /\balter\s+table\b/i);
});

test("Phase 3C-A removes broad true and anon-dev policies only", () => {
  for (const [tableName, policyName] of [
    ["audit_log", "audit_log_all_authenticated"],
    ["deals", "deals_insert_anon_dev"],
    ["deal_people", "deal_people_insert_anon_dev"],
    ["income_profiles", "income_profiles_insert_anon_dev"],
  ]) {
    assert.match(
      phase3cAMigrationSql,
      new RegExp(
        `drop policy if exists "${policyName}" on public\\.${tableName}`,
        "i"
      ),
      `${phase3cAMigrationPath} should drop ${policyName}`
    );
  }

  for (const policyName of [
    "Admins can update all documents",
    "Admins can view all documents",
    "Users can insert own documents",
    "Users can view own documents",
  ]) {
    assert.match(
      phase3cAMigrationSql,
      new RegExp(
        `drop policy if exists "${escapeRegExp(policyName)}" on public\\.documents`,
        "i"
      ),
      `${phase3cAMigrationPath} should drop legacy documents policy ${policyName}`
    );
  }

  assert.doesNotMatch(phase3cAMigrationSql, /\busing\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(phase3cAMigrationSql, /\bwith\s+check\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(phase3cAMigrationSql, /\binsert\s+into\b/i);
  assert.doesNotMatch(phase3cAMigrationSql, /\bupdate\s+public\./i);
  assert.doesNotMatch(phase3cAMigrationSql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(phase3cAMigrationSql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(phase3cAMigrationSql, /\bdrop\s+function\b/i);
  assert.doesNotMatch(phase3cAMigrationSql, /\balter\s+table\b/i);
});

test("Phase 3C-A revokes anonymous access on approved active and legacy surfaces", () => {
  const tables = [
    "audit_log",
    "deals",
    "deal_people",
    "income_profiles",
    "documents",
    "vehicle_options",
    "vehicle_selection",
    "deal_management_notes",
    "bhph_bureau_rules",
  ];

  for (const table of tables) {
    assert.match(
      phase3cAMigrationSql,
      new RegExp(`revoke all on table public\\.${table} from anon`, "i"),
      `${phase3cAMigrationPath} should revoke anon access on ${table}`
    );
  }

  for (const table of [
    "audit_log",
    "documents",
    "vehicle_options",
    "vehicle_selection",
    "deal_management_notes",
  ]) {
    assert.match(
      phase3cAMigrationSql,
      new RegExp(
        `revoke insert, update, delete, truncate, references, trigger\\s+on table public\\.${table}\\s+from authenticated`,
        "i"
      ),
      `${phase3cAMigrationPath} should remove authenticated writes on legacy table ${table}`
    );
    assert.match(
      phase3cAMigrationSql,
      new RegExp(`grant select on table public\\.${table} to authenticated`, "i"),
      `${phase3cAMigrationPath} should preserve authenticated reads on ${table}`
    );
  }
});

test("Phase 3C-A preserves authenticated deal workflow writes", () => {
  for (const table of ["deals", "deal_people", "income_profiles"]) {
    assert.doesNotMatch(
      phase3cAMigrationSql,
      new RegExp(
        `revoke insert, update, delete, truncate, references, trigger\\s+on table public\\.${table}\\s+from authenticated`,
        "i"
      ),
      `${phase3cAMigrationPath} should leave authenticated grants on active ${table} workflow table`
    );
  }

  const apiRouteSource = readRepoFile("src/app/api/deals/route.ts");
  const newDealPageSource = readRepoFile("src/app/(app)/deals/new/page.tsx");

  for (const source of [apiRouteSource, newDealPageSource]) {
    assert.match(source, /p_organization_id:\s*organizationId/);
    assert.doesNotMatch(
      source,
      /rpc\("create_deal_with_seed_data",\s*\{\s*p_customer_name:\s*customer_name\s*\}\s*\)/i
    );
  }
});

test("Phase 3C-A removes direct anon and no-org deal creation RPC access", () => {
  assert.match(
    phase3cAMigrationSql,
    /revoke execute on function public\.create_deal_with_seed_data\(text\)\s+from public, anon, authenticated/i
  );
  assert.match(
    phase3cAMigrationSql,
    /revoke execute on function public\.create_deal_with_seed_data\(text, uuid\)\s+from public, anon/i
  );
  assert.match(
    phase3cAMigrationSql,
    /grant execute on function public\.create_deal_with_seed_data\(text, uuid\)\s+to authenticated/i
  );
  assert.doesNotMatch(phase3cAMigrationSql, /\bgrant\s+execute\b[\s\S]+?\bto\s+anon\b/i);
});

test("Phase 3C-B stamps seeded deal children with the parent organization", () => {
  assert.match(
    phase3cBMigrationSql,
    /create or replace function public\.create_deal_with_seed_data\(\s*p_customer_name text,\s*p_organization_id uuid\s*\)/i
  );
  assert.match(phase3cBMigrationSql, /\bsecurity definer\b/i);
  assert.match(
    phase3cBMigrationSql,
    /if not public\.is_active_organization_member\(p_organization_id\) then/i
  );
  assert.match(
    phase3cBMigrationSql,
    /update public\.deal_people[\s\S]+?set organization_id = p_organization_id[\s\S]+?where deal_id = v_created\.deal_id[\s\S]+?and organization_id is null/i
  );
  assert.match(
    phase3cBMigrationSql,
    /update public\.income_profiles income[\s\S]+?set organization_id = p_organization_id[\s\S]+?from public\.deal_people person[\s\S]+?person\.id = income\.deal_person_id[\s\S]+?person\.deal_id = v_created\.deal_id[\s\S]+?income\.organization_id is null/i
  );
});

test("Phase 3C-B backfills only child rows with an org-scoped parent", () => {
  assert.match(
    phase3cBMigrationSql,
    /update public\.deal_people person[\s\S]+?set organization_id = deal\.organization_id[\s\S]+?from public\.deals deal[\s\S]+?deal\.id = person\.deal_id[\s\S]+?deal\.organization_id is not null[\s\S]+?person\.organization_id is null/i
  );
  assert.match(
    phase3cBMigrationSql,
    /update public\.income_profiles income[\s\S]+?set organization_id = person\.organization_id[\s\S]+?from public\.deal_people person[\s\S]+?person\.id = income\.deal_person_id[\s\S]+?person\.organization_id is not null[\s\S]+?income\.organization_id is null/i
  );
  assert.doesNotMatch(phase3cBMigrationSql, /\bdrop\s+policy\b/i);
  assert.doesNotMatch(phase3cBMigrationSql, /\bcreate\s+policy\b/i);
  assert.doesNotMatch(phase3cBMigrationSql, /\bgrant\b/i);
  assert.doesNotMatch(phase3cBMigrationSql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(phase3cBMigrationSql, /\bdrop\s+function\b/i);
  assert.doesNotMatch(phase3cBMigrationSql, /\bset\s+not\s+null\b/i);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
