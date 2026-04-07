# Multi-Tenant Next Migration Targets

This foundation adds organization-aware auth, memberships, and settings without
forcing an immediate whole-app rewrite. The next safest table migrations should
follow the existing deal workflow dependency chain.

## Recommended order

1. `deals`
   Add `organization_id` first. Nearly every workflow route starts here, so this
   becomes the primary tenant boundary for the rest of the pipeline.

2. Deal child tables
   Migrate `deal_people`, `income_profiles`, `deal_documents`,
   `deal_structure`, and `deal_vehicle_selection` next. These are all queried by
   `deal_id` and should either receive their own `organization_id` column or be
   protected through joins plus consistent write-path validation.

3. Underwriting tables
   Migrate `underwriting_inputs` and `underwriting_results` after `deals`.
   They drive workflow gates and vehicle/deal structure decisions, so they need
   the same organization scoping as the parent deal.

4. Inventory/config tables
   Review whether `trivian_inventory`, `vehicle_term_policy`,
   `underwriting_tier_policy`, and `trivian_config` are dealership-specific or
   shared platform data. If the data varies by dealership, add
   `organization_id`; if it is truly global platform configuration, keep it
   centralized and explicitly document that choice.

5. Credit bureau / reporting tables
   Migrate `credit_report_jobs`, `credit_reports`, `bureau_summary`,
   `bureau_tradelines`, `bureau_messages`, and `bureau_public_records` once the
   deal boundary is in place. These are sensitive and should inherit the same
   tenant boundary as the originating deal.

## Practical migration pattern

- Add nullable `organization_id`.
- Backfill from the parent record (`deals` or the owning organization).
- Add indexes that match the new access pattern.
- Update reads/writes to filter by `organization_id`.
- Add or tighten RLS.
- Only then make `organization_id` non-null where appropriate.
