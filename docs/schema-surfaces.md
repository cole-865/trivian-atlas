# Atlas Schema Surfaces

This document marks schema surfaces that are intentionally transitional after the
tenant-boundary hardening passes. It is not a removal plan by itself. Do not
drop or merge these tables/functions until a separate retirement migration has
confirmed production usage, row counts, dependent objects, and rollback
requirements.

## Current Application-Owned Surfaces

These are the tables and helpers the current app code should use for active
dealership workflows.

| Domain | Current surface | Notes |
| --- | --- | --- |
| Deal documents | `deal_documents` | Current document metadata table used by deal document routes, funding, submit, bureau upload, and worker cleanup flows. |
| Vehicle structuring | `deal_structure`, `deal_structure_inputs`, `deal_vehicle_selection` | Current deal-scoped vehicle selection and structure persistence. `deal_structure` and `deal_vehicle_selection` are keyed by `deal_id`, not a separate `id`. |
| Deal workflow | `deals`, `deal_people`, `income_profiles`, `underwriting_inputs`, `underwriting_results` | Current workflow path. Queries should be scoped by `organization_id` directly or through org-aware deal helpers. |
| Inventory and settings | `trivian_inventory`, `vehicle_term_policy`, `underwriting_tier_policy`, `trivian_config` | Current dealership-scoped inventory/config surfaces. `trivian_config` is expected to be organization-scoped; global fallback rows were removed from app code in Phase 3A. |
| Bureau ingestion | `credit_report_jobs`, `credit_reports`, `bureau_summary`, `bureau_tradelines`, `bureau_public_records`, `bureau_messages` | Current credit-worker write path. Worker writes must preserve `organization_id`. |

## Deprecated Or Transitional Surfaces

These surfaces exist in migrations/generated types but are not the current app
ownership boundary.

| Surface | Status | Why it remains | Current action |
| --- | --- | --- | --- |
| `documents` | Legacy table | Superseded by `deal_documents`; kept for migration history and production verification. | Phase 2 added parent-deal member policies; Phase 3C-A removed legacy broad document policies and anonymous grants. Do not drop until a separate retirement pass validates row usage and rollback. |
| `vehicle_options` | Legacy table | Superseded by `deal_structure` and generated vehicle structure options in TypeScript. | Phase 2 added parent-deal member policies; Phase 3C-A removed anonymous grants and direct authenticated writes. Do not drop until a separate retirement pass validates row usage and rollback. |
| `vehicle_selection` | Legacy table | Superseded by `deal_vehicle_selection`. | Phase 2 added parent-deal member policies; Phase 3C-A removed anonymous grants and direct authenticated writes. Do not drop until a separate retirement pass validates row usage and rollback. |
| `atlas_dashboard_metrics()` | Legacy SQL dashboard RPC | No non-generated app usage found during the Phase 1 audit. | Revoked direct `public`/`anon`/`authenticated` execution. |
| `bhph_evaluate_bureau(uuid)` and `bhph_bureau_rules` | Legacy database underwriting surface | Current bureau scoring and decision assistance lives in TypeScript and worker/application flows; keep until production data and old workflows are verified. | Revoked direct `public`/`anon`/`authenticated` execution on the function; Phase 2 made table policies platform-dev only; Phase 3C-A removed anonymous table grants. |
| `trivian_*` SQL quote/payment helpers | Legacy database vehicle-quote surface | Current vehicle structuring/payment-fit behavior lives in TypeScript. The SQL helpers remain for compatibility until removal safety is verified. | Revoked direct `public`/`anon`/`authenticated` execution on confirmed-unused functions. |

## Guardrails

- Do not reintroduce new application code against `documents`,
  `vehicle_options`, or `vehicle_selection`.
- Do not call `trivian_*` SQL helpers from route handlers or frontend code. Use
  the existing TypeScript vehicle structuring services.
- Do not remove `trivian_config`; only the legacy SQL helper functions around it
  are marked deprecated here.
- Do not drop legacy tables/functions in Phase 1. First verify production row
  counts, dependent views/RPCs, backups, and rollback requirements.
- Do not re-add legacy permissive table policies or anonymous grants after the
  Phase 3C hardening passes.
- Do not drop legacy tables/functions just because direct app usage is absent;
  first validate dependent views/RPCs, production row counts, rollback, and any
  reporting/export integrations.
- If generated Supabase types still include deprecated surfaces, prefer a
  documentation comment or test guard over deleting generated entries by hand.
