# API Contracts - Trivian Atlas

## Purpose
This file defines API behavior rules and contract expectations for Atlas.

Codex must:
- preserve existing response shapes unless explicitly told otherwise
- avoid renaming fields in API responses
- avoid changing endpoint semantics without instruction
- keep all business endpoints organization-scoped
- prefer extending existing routes over creating duplicate ones

---

## Global API Rules

- All business endpoints must operate within the current organization context.
- Never trust client-provided `organization_id`.
- Resolve organization from existing server-side org context and auth helpers.
- Do not expose cross-organization data.
- Do not redesign auth/session handling inside route work.
- Do not change a route from server-safe checks to client-trusted checks.

---

## Response Shape Rules

- Do not rename existing top-level response keys without instruction.
- Do not silently remove fields that existing UI depends on.
- Prefer adding fields over mutating or deleting existing ones.
- Return stable JSON with predictable nullability.
- For boolean state, use explicit booleans rather than truthy/falsy coercion.
- For numeric outputs used in structuring, return numbers, not formatted strings.
- Keep human display formatting in UI, not in API responses.

---

## Error Handling Rules

- Return safe error messages.
- Do not leak internal auth details, SQL errors, stack traces, raw Supabase errors, or environment details.
- Prefer explicit status codes.
- Validation failures should be distinguishable from authorization failures.
- Health and status endpoints should remain minimal and non-sensitive.

---

## Authorization Rules

- Server-side authorization is required for any endpoint that reads or writes business data.
- Use existing organization membership, role, permissions, and impersonation helpers.
- Do not invent a second authorization path.
- Platform dev permissions are global and separate from normal org-managed roles.
- Normal org-managed UI roles remain:
  - sales
  - management
  - admin

---

## Route Design Rules

- Keep route changes localized.
- Reuse existing helpers before adding new abstractions.
- Prefer small helper additions over major refactors.
- Do not split one stable endpoint into multiple new endpoints unless explicitly instructed.
- Preserve current route ownership and naming patterns in the repo.

---

# Core Domain Endpoints

## Deals

### Deal creation and seed flow
Purpose:
- Create a deal shell and initial workflow data.

Rules:
- New deals must be organization-scoped.
- Use existing server-side create patterns and seed helpers.
- Do not create incomplete deal records that bypass expected defaults.
- Preserve current deal workflow initialization behavior.

Likely core entities touched:
- `deals`
- `deal_people`
- related seed/default records as implemented

---

### Deal read/update endpoints
Purpose:
- Load and update deal progress across steps.

Rules:
- All reads/writes must be scoped to current organization.
- Preserve step-based workflow behavior.
- Do not let one step overwrite unrelated workflow state unless explicitly intended.
- Avoid mixing display-only computed values into persisted base records unless current behavior already does so.

Core source of truth:
- `deals`

---

## Customer step

Purpose:
- Capture applicant and co-applicant data and uploaded documents.

Rules:
- Customer step must preserve current applicant role model:
  - `primary`
  - `co`
- Residence and contact data belong in `deal_people`.
- Uploaded docs should be persisted through existing document/storage paths.
- Do not weaken document validation rules without instruction.

Core tables:
- `deal_people`
- `deal_documents`
- `credit_reports`
- `credit_report_jobs`

---

## Income step

Purpose:
- Capture and calculate income used for underwriting and payment qualification.

Rules:
- Income calculations must remain numeric and server-safe.
- W2/manual income inputs should resolve into `income_profiles`.
- Deal-level income values used for underwriting belong in underwriting inputs/results flow, not ad hoc client state.
- Household income behavior must preserve current semantics.
- Do not move income logic into scattered UI-only calculations.

Core tables:
- `income_profiles`
- `underwriting_inputs`
- `deals`

Important outputs:
- gross monthly income
- total monthly income
- max payment inputs used later in structure flow

---

## Vehicle options endpoint

Purpose:
- Return available structures for inventory units for a deal.

This is one of the highest-risk endpoints. Do not casually rewrite it.

Expected behavior:
- returns structured vehicle options
- evaluates constraints
- returns fail reasons
- returns additional down required when needed
- preserves stable typed JSON shape

Must use:
- current deal context
- underwriting results
- underwriting inputs when relevant
- current org-scoped inventory
- config + term policy

Core data sources:
- `deals`
- `underwriting_results`
- `underwriting_inputs`
- `trivian_inventory`
- `trivian_config`
- `vehicle_term_policy`

Constraint logic must respect:
- PTI
- LTV
- max amount financed
- max vehicle price
- min cash down / min down percent
- term caps

Output expectations:
- vehicles that structure should sort first
- failures should use normalized blocker codes
- additional down should be returned as a number
- payment should be returned as a number
- do not return formatted currency strings as the primary data contract

Do not:
- hardcode limits outside config/results
- bypass `underwriting_results`
- change fail reason naming without instruction

---

## Vehicle selection endpoint

Purpose:
- Save the chosen vehicle and selected product structure.

Rules:
- Selected vehicle must belong to the active organization inventory scope.
- Persist chosen structure cleanly.
- Do not save inconsistent selection data that disagrees with the computed structure summary.
- Preserve current one-selection-per-deal pattern if already enforced.

Core tables:
- `deal_vehicle_selection`
- `deal_structure_inputs`
- `deal_structure`

---

## Structuring / submit / fund flow

Purpose:
- Move from selected structure to final deal summary and funding readiness.

Rules:
- `deal_structure` is computed state, not user-authored truth.
- Persist snapshots consistently when current flow expects them.
- Funding-related routes must not silently mutate underwriting outputs.
- Do not collapse submit/fund concepts into one endpoint unless explicitly told.

Core tables:
- `deal_structure`
- `deal_structure_inputs`
- `deal_funding_stip_verifications`
- `deals`

---

## Underwriting / scoring endpoints

Purpose:
- Evaluate and persist underwriting decisions and caps.

Rules:
- `underwriting_results` is the source of truth for structure caps.
- Do not recompute tier logic differently in multiple places.
- Do not invent alternate approval logic in route handlers.
- If scoring is recalculated, update all dependent outputs consistently.

Core tables:
- `underwriting_inputs`
- `underwriting_results`
- `underwriting_tier_policy`
- `bhph_bureau_rules`
- `bureau_summary`

---

## Override request endpoints

Purpose:
- Handle approval workflows for deals that fail a constraint.

Rules:
- Override requests must capture structure snapshots and blocker context.
- Counter-offers must preserve snapshot/version behavior.
- Approval authority must use existing permission rules.
- Changes to selected vehicle/down/product mix can stale an override; preserve stale handling patterns.
- Log reviewer identity where current schema supports it.

Core tables:
- `deal_override_requests`
- `deal_override_counter_offers`
- `app_notifications`

Expected concepts:
- blocker code
- requested note
- reviewed by
- structure fingerprint
- stale reason
- status progression

---

## Notifications endpoints

Purpose:
- Surface in-app operational notifications.

Rules:
- Notifications are user-specific and organization-scoped.
- Mark-read behavior must not affect other users.
- Notification payloads should stay lightweight.
- Do not embed large business objects into notification response bodies if a link/ID is enough.

Core table:
- `app_notifications`

---

## Organization and user management endpoints

Purpose:
- Handle org membership, invites, and settings boundaries.

Rules:
- Admins manage only their organization.
- Platform dev can manage across organizations.
- Do not expose `dev` as a normal assignable org UI role.
- Removing a user means deactivating org membership, not deleting auth users.
- Invitation flow must use hashed tokens and expiration.
- New organization creation must seed configured defaults and create an initial invite.

Core tables:
- `organizations`
- `organization_users`
- `organization_invitations`
- `organization_settings`
- seeded settings/policy tables

---

## Settings endpoints

Purpose:
- Edit operational dealership settings.

Rules:
- Operational settings remain organization-scoped.
- Dev/debug settings stay separate from dealership-owned settings.
- Preserve current settings boundaries.
- Avoid mixing unrelated settings in one endpoint response if existing routes are segmented.

Core tables:
- `organization_settings`
- `trivian_config`
- `vehicle_term_policy`
- `underwriting_tier_policy`

---

## Credit report processing endpoints

Purpose:
- Handle upload, queueing, parsing, and redaction workflow.

Rules:
- Raw and redacted artifacts must stay in existing storage flow.
- Queue/job state transitions must remain valid.
- Do not expose extracted raw report text broadly in user-facing routes.
- Preserve status lifecycle semantics.

Core tables:
- `credit_reports`
- `credit_report_jobs`
- `bureau_summary`
- `bureau_tradelines`
- `bureau_public_records`
- `bureau_messages`

Expected status values:
- queued
- uploaded
- parsing
- redacting
- scoring
- done
- failed

---

# Health / Diagnostics Endpoints

## Health endpoint
Purpose:
- Support monitoring only.

Rules:
- Keep response minimal.
- Do not expose row counts, tenant info, auth state details, or raw exception messages.
- Prefer:
  - `200` healthy
  - `503` unhealthy
- HEAD support is acceptable for monitoring if already implemented.

---

# API Output Conventions

## Use IDs for joins/navigation
- Prefer stable IDs and codes in API outputs.
- UI can separately resolve labels where needed.

## Nullability
- Use `null` intentionally.
- Do not replace `null` with magic values like `0`, `""`, or `"unknown"` unless that is the established contract.

## Dates
- Return ISO timestamps for stored datetimes.
- Keep date formatting in the UI layer.

## Money and ratios
- Return raw numeric values:
  - `monthly_payment`
  - `amount_financed`
  - `max_ltv`
  - `max_pti`
- Do not return display-formatted strings as the source of truth.

---

# Safe Change Rules for Codex

Before changing an endpoint, inspect:
- current route file
- helper(s) it already uses
- dependent UI page/component
- dependent tests if present

When making changes, report:
1. Summary of what changed
2. Exact changed files
3. New routes/actions/helpers added
4. Schema or migration changes
5. Assumptions or limitations
6. Manual test steps

Do not claim a route contract changed unless it actually did.
Do not make “cleanup” changes that alter behavior unless explicitly requested.

---

# High-Risk API Areas

Treat these as high-risk and preserve behavior carefully:
- vehicle options / structuring
- override workflow
- organization switching / impersonation
- health endpoint
- credit report processing
- submit/fund workflow

If uncertain:
- preserve existing contract
- prefer smaller changes
- avoid speculative refactors