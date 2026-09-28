# Ask 865 module

Implementation prepared September 27, 2026. Production database activation was explicitly approved and completed September 28, 2026. Atlas application deployment is in progress.

## Behavior

`/ask865` brings the existing Ask 865 reporting screens into Atlas's application shell: Overview, Sales, Inventory, Leads/source coverage, Service history, Finance, BHPH summaries, Daily Briefing and Data Health. It uses Atlas's existing login, current organization, active profiles, impersonation context and editable dealership permissions. There is no second login, public reporting endpoint, new database password, chatbot, billing/subscription integration or new domain.

Sales filters and comparisons preserve the established dashboard definitions. Inventory and exception sections use their current snapshots. Service remains the explicitly labelled historical 2026 Shop-Ware import; pending sources are shown as unavailable rather than fabricated. Portfolio Radar remains a separate linked Atlas destination.

## Access and tenant boundary

- The migration enables `ask865` only for the existing `865-autos` organization.
- `view_ask865`: default true for management/admin; false for sales. Existing per-user permission overrides apply.
- `review_ask865_sources`: default true for admin only. Review edits change owner, notes and review status; they cannot resolve or rewrite the imported source issue.
- Export buttons respect the existing `export_reports` permission. Reporting users can already inspect the displayed data; this is an export-feature control, not DRM.
- An active, database-backed platform dev may view the connected module. While impersonating, the effective organization user's reporting permissions apply. No module access or administration is granted by user-editable metadata role fallbacks.
- `/dev-tools/modules` lets a non-impersonating active platform dev enable/disable a configured module for the current account. The action rechecks the current server organization and refuses a stale form.
- All API requests recheck authentication, organization, module enablement and permission. A browser organization identifier is only compared to the server-resolved organization to reject stale tabs; it never selects a database scope. Abortable fetches and component remounting prevent old organization responses from replacing new ones.
- The private imported Ask 865 schema remains constrained to a single organization on every table. The service-only RPC requires the requested organization to own the imported report definitions, be active, and have the module enabled. Enabling a different dealership cannot expose 865 Autos data. Supporting another dealership requires its own data/model integration.
- RPCs are SECURITY INVOKER with empty search paths and explicit grants only to `service_role`; PUBLIC/anon/authenticated cannot execute them. Browser roles cannot query the entitlement table or private reporting schema. Server-side service access is intentional after authorization, matching Atlas's existing organization-management pattern.

## Schema

Applied `supabase/migrations/20260928101122_ask865_atlas_module.sql`:

1. Creates RLS-protected `public.organization_modules`, accessible only to the server service role.
2. Adds two permission keys without removing any existing ones; verified against live constraints.
3. Seeds the approved defaults and enables Ask 865 only for 865 Autos.
4. Adds fixed, parameterized `atlas_ask865_dashboard` and `atlas_ask865_review` RPCs. The reporting RPC uses the existing reporting views and returns one response rather than accepting raw SQL.
5. Grants the service role access to the required private views, report definitions, and limited source-review columns.

The migration was generated with the official Supabase CLI and rehearsed in isolated `ask865_module_test_20260928`. It was applied to production through Supabase MCP (local CLI unavailable); the tracked filename matches production history version `20260928101122`.

The user explicitly approved activation for 865 Autos, management/admin viewing, admin-only source review, existing export permissions, and Atlas deployment. Production verification confirmed exactly these defaults, RLS enabled, no browser table access, and no anonymous/authenticated RPC execution grants.

## Verification

- `npm run lint`, `npm run typecheck`, `npm test`: passed; 171 tests.
- `npm run build`: production build including the new page, API routes and module settings.
- Isolated database: sales totals matched original reporting views; inventory/service populated; all 23 feeds returned; source-review updates verified inside a rolled-back transaction.
- Disabled organization modules and unrelated dealerships were denied, including when the unrelated dealership was temporarily granted an enabled entitlement in the test transaction. Browser-role RPC and entitlement access were denied. All test changes rolled back.
- Production-build HTTP smoke: `/ask865` redirects anonymous requests to login; reporting API returns 401. Cross-origin source-review requests return 403. Same-origin validation compares the external request Host, because Next standalone can use its internal bind address in `nextUrl.origin`.
- Browser preview uses the actual module components, actual Atlas shell/CSS, and a private fixture from the rehearsal database, outside the Atlas repository. It is labelled isolated preview. Overview, inventory search, service history and read-only source-review controls were inspected. At 390 px, document width remained 390 px with no page overflow.
- An authenticated end-to-end production session and production Supabase advisors for the pending schema are still required after activation. The preview is not evidence of a deployed module.

## Activation after approval

1. Apply the pending tracked module migration to `qrpzvhuorhitxmxoylts`. The two preceding Ask 865 migration files are already applied; do not reapply them. Verify/align the server migration-history version if using Supabase MCP as the CLI fallback.
2. Run the relevant security advisors and test the service RPC on production using aggregate results only. Confirm no anonymous/authenticated execution grants and all new tables have RLS.
3. Deploy the Atlas application through its existing Coolify application after checking saved deployment configuration. No additional secrets or package dependencies are needed.
4. Sign into Atlas, select 865 Autos, open Ask 865, and verify Overview/Data Health. Check sales/date filters and service history. Test authorized review save by reopening the issue, preserving/restoring its original content if testing a real issue.
5. Use impersonation to confirm management viewing, admin reviews, denied sales access and denied user overrides. Switch organizations and confirm the module is unavailable. Disable/re-enable the module through platform settings and verify page/API behavior.

For rollback, disable the module via platform settings and redeploy the prior application revision if needed. Preserve migrated reporting data and the n8n connection; no database deletion is required.

## Changed files

New:

- `src/app/(app)/ask865/page.tsx`
- `src/app/(app)/ask865/ask865.css`
- `src/app/(app)/dev-tools/modules/page.tsx`
- `src/app/(app)/dev-tools/modules/actions.ts`
- `src/app/api/ask865/dashboard/route.ts`
- `src/app/api/ask865/source-issues/route.ts`
- `src/components/ask865/DashboardApp.tsx`
- `src/components/ask865/DataHealth.tsx`
- `src/components/ask865/ServiceHistory.tsx`
- `src/lib/ask865/access.ts`
- `src/lib/ask865/accessRules.ts`
- `src/lib/ask865/data.ts`
- `src/lib/ask865/filters.ts`
- `src/lib/ask865/normalize.ts`
- `src/lib/ask865/review.ts`
- `src/lib/ask865/types.ts`
- `supabase/migrations/20260928101122_ask865_atlas_module.sql`
- `tests/ask865.test.ts`
- `docs/ask865-module.md`

Updated:

- `src/app/(app)/layout.tsx`: gated navigation.
- `src/app/(app)/dev-tools/page.tsx`: account module administration link.
- `src/lib/auth/permissionRegistry.ts`: existing permission-system extension.
- `src/lib/supabase/database.generated.ts`: types for the pending table/RPCs.
- `src/proxy.ts`: protected module page path.
- `tests/dealershipPermissions.test.ts`, `tests/settingsAccess.test.ts`: expected permission defaults/fixtures.

The existing uncommitted `20260928011804_ask865_reporting_import.sql` and `20260928013830_ask865_operator_ingest_role.sql` files belong to the completed cutover. They were preserved. No code has been committed or pushed during this module implementation.

## Production database verification — September 28, 2026

- Reporting RPC executed as service_role: 221 sold deals for January 1–September 28, 89 inventory units, 23 import feeds, 18 service month/billing groups.
- Only 865 Autos has an enabled entitlement.
- Security advisor: module table has RLS with no browser policies intentionally (server-only); new functions have fixed search paths and are invoker-only. Existing Atlas advisories remain outside this change: mutable search paths, callable security-definer helpers, and disabled leaked-password protection. Guidance: [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [anonymous function access](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated function access](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
