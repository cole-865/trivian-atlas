# Tenant Boundary Audit

## Completed in this pass

| Area | Status | Notes |
| --- | --- | --- |
| `src/app/api/deals/route.ts` | verified | Deal creation resolves current organization before invoking RPC. |
| `src/app/api/deals/[dealId]/**` core reads/writes | verified | Core deal, customer, people, income, submit, structure, vehicle-selection, underwriting refresh, and fund routes scope by `organization_id` directly or via org-aware helpers. |
| Credit bureau upload/delete cleanup | hardened | Bureau uploads and bureau document deletion now purge downstream org-scoped artifacts (`credit_reports`, `bureau_summary`, `bureau_tradelines`, `bureau_public_records`, `bureau_messages`) through one shared helper. |
| Credit bureau rollback path | hardened | Queue failure rollback now deletes the inserted document row with both `organization_id` and `id`. |
| Credit worker organization propagation | verified | Worker now has explicit tested helpers for bureau detection, duplicate extraction handling, redacted-path generation, and organization stamping when queued jobs arrive without `organization_id`. |
| Legacy permissive RLS/function grants | migration tracked | `20260521031120_harden_legacy_rls_and_function_grants.sql` defensively drops only confirmed permissive authenticated deal/person/income policies with tracked scoped replacements, and revokes direct `public`/`anon`/`authenticated` execution on confirmed-unused legacy SQL helpers. It intentionally leaves legacy table/anon policies in place until live RLS validation confirms removal safety. |
| Identity/settings direct API hardening | production verified | Phase 3B narrows direct anon/authenticated grants and policies on `app_settings`, `trivian_config`, `organizations`, `profiles`, and `user_profiles`. |
| Remaining broad legacy access | production verified | Phase 3C-A removes the remaining broad true/anon-dev policies and anonymous grants on approved active/legacy surfaces without loosening RLS. |
| Seeded deal child org propagation | production verified | Phase 3C-B updates the org-aware deal creation RPC and backfills seeded `deal_people` / `income_profiles` rows from their parent deal organization. |

## Remaining follow-up

| Area | Priority | Notes |
| --- | --- | --- |
| Database/RLS validation | high | Confirm every org-scoped table in `docs/supabase/multi-tenant-next-targets.md` has matching production RLS and indexes, not just application-layer filters. |
| Credit worker integration coverage | medium | Pure worker rules are now covered, but the async write path still lacks mocked integration tests around Supabase mutations and storage operations. |
| Regression coverage | high | Add tests for invite boundaries, impersonation boundaries, and cross-org denial cases. |
| Deprecated schema removal | medium | Use `docs/schema-surfaces.md` as the retirement checklist after production row counts, dependency checks, and rollback steps are documented. Do not drop legacy tables/functions until that separate retirement pass is approved. |
