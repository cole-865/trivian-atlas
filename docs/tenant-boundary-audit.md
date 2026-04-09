# Tenant Boundary Audit

## Completed in this pass

| Area | Status | Notes |
| --- | --- | --- |
| `src/app/api/deals/route.ts` | verified | Deal creation resolves current organization before invoking RPC. |
| `src/app/api/deals/[dealId]/**` core reads/writes | verified | Core deal, customer, people, income, submit, structure, vehicle-selection, underwriting refresh, and fund routes scope by `organization_id` directly or via org-aware helpers. |
| Credit bureau upload/delete cleanup | hardened | Bureau uploads and bureau document deletion now purge downstream org-scoped artifacts (`credit_reports`, `bureau_summary`, `bureau_tradelines`, `bureau_public_records`, `bureau_messages`) through one shared helper. |
| Credit bureau rollback path | hardened | Queue failure rollback now deletes the inserted document row with both `organization_id` and `id`. |
| Credit worker organization propagation | verified | Worker now has explicit tested helpers for bureau detection, duplicate extraction handling, redacted-path generation, and organization stamping when queued jobs arrive without `organization_id`. |

## Remaining follow-up

| Area | Priority | Notes |
| --- | --- | --- |
| Database/RLS validation | high | Confirm every org-scoped table in `docs/supabase/multi-tenant-next-targets.md` has matching production RLS and indexes, not just application-layer filters. |
| Credit worker integration coverage | medium | Pure worker rules are now covered, but the async write path still lacks mocked integration tests around Supabase mutations and storage operations. |
| Regression coverage | high | Add tests for invite boundaries, impersonation boundaries, and cross-org denial cases. |
| Transitional global config fallback | medium | `src/lib/los/organizationScope.ts` still falls back to global `trivian_config` rows where `organization_id is null`; keep only if that migration is intentionally incomplete. |
