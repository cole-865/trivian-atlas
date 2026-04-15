# API Surface - Atlas

## Purpose

This file documents the API routes currently implemented in the Next.js App Router under `src/app/api`.

Codex must:
- treat this as a map of the current API, not as a contract for new endpoints
- keep all business routes organization-scoped
- use existing Supabase server clients and org-scope helpers
- preserve existing workflow gates such as `canAccessStep`
- avoid trusting client-provided `organization_id`

---

## Core rules

All deal APIs are server-side Next.js route handlers.

- Base path: `/api`
- Auth: Supabase Auth session cookies via `supabaseServer()` or `createClient()`
- Tenant scope: current organization is resolved server-side through helpers in `src/lib/deals/organizationScope.ts`
- Common missing-org error: `NO_CURRENT_ORGANIZATION_MESSAGE`
- Common error shape: `{ error: string, details?: string }`
- Many success responses include `{ ok: true, ... }`, but not every route does
- Route params are App Router async params, for example `{ params: Promise<{ dealId: string }> }`

Do not add APIs that accept an arbitrary `organization_id` from the browser for business data writes.

---

## Primary helpers

### Supabase clients

- `src/lib/supabase/server.ts`
  - `supabaseServer()`
  - Used by most route handlers.

- `src/utils/supabase/server.ts`
  - `createClient()`
  - Used by a few older/simple routes.

- `src/lib/supabase/admin.ts`
  - `createAdminClient()`
  - Used where service-role writes are needed, such as funding stip verification.

### Organization scoping

- `assertDealInCurrentOrganization(supabase, dealId)`
  - Confirms the deal belongs to the current organization.

- `getDealForCurrentOrganization<T>(supabase, dealId, select)`
  - Loads a deal scoped to the current organization and returns `organizationId`.

- `getCurrentOrganizationIdForDeals(supabase)`
  - Resolves the current org for deal creation.

- `scopeQueryToOrganization(query, organizationId)`
  - Adds org scope to child table queries.

- `scopeDealChildQueryToOrganization(query, organizationId, dealId)`
  - Adds org and deal scope to underwriting/deal child tables.

- `scopeDealStageQueryToOrganization(query, organizationId, dealId, stage)`
  - Adds org, deal, and underwriting stage scope.

### Workflow gates

- `canAccessStep(...)`
  - Used to block routes when the deal workflow is not ready.
  - Blocked responses usually look like:

```json
{
  "ok": false,
  "error": "STEP_BLOCKED",
  "redirectTo": "income",
  "reason": "..."
}
```

---

## System routes

### `GET /api/health`

Source: `src/app/api/health/route.ts`

Checks app health by querying `organizations`.

- `GET` returns health JSON from `getHealthResponsePayload`.
- `HEAD` returns only the status/init from `getHealthResponseInit`.

### `POST /api/logout`

Source: `src/app/api/logout/route.ts`

Signs the Supabase session out and redirects to `/login`.

---

## Deals

### `POST /api/deals`

Source: `src/app/api/deals/route.ts`

Creates a deal in the current organization using the RPC `create_deal_with_seed_data`.

Request:

```json
{
  "customer_name": "Jane Buyer"
}
```

Response:

```json
{
  "deal": {
    "id": "uuid",
    "approval_number": "..."
  }
}
```

Notes:
- `customer_name` is required.
- `organization_id` comes from current org context, not the request body.

### `GET /api/deals/:dealId`

Source: `src/app/api/deals/[dealId]/route.ts`

Loads the deal summary packet:
- deal
- people
- income profiles
- documents
- current deal structure
- vehicle selection

Response includes:

```json
{
  "deal": {},
  "people": [],
  "income_profiles": [],
  "documents": [],
  "vehicle_options": [],
  "vehicle_selection": null,
  "deal_structure": null
}
```

### `PATCH /api/deals/:dealId`

Source: `src/app/api/deals/[dealId]/route.ts`

Updates deal trade/down-payment fields after workflow access checks.

Request fields:
- `cash_down`
- `trade_value`
- `trade_payoff`
- `has_trade`

Response:

```json
{
  "ok": true,
  "deal": {}
}
```

---

## Customer and applicants

### `POST /api/deals/:dealId/customer`

Source: `src/app/api/deals/[dealId]/customer/route.ts`

Updates `deals.customer_name`.

Request:

```json
{
  "customer_name": "Jane Buyer"
}
```

Response:

```json
{ "ok": true }
```

### `GET /api/deals/:dealId/people`

Source: `src/app/api/deals/[dealId]/people/route.ts`

Returns all `deal_people` rows for the deal.

Response:

```json
{
  "ok": true,
  "dealId": "uuid",
  "people": []
}
```

### `PATCH /api/deals/:dealId/people/:role`

Source: `src/app/api/deals/[dealId]/people/[role]/route.ts`

Upserts applicant data for `role`.

Allowed roles:
- `primary`
- `co`

Request fields:
- `first_name`
- `last_name`
- `phone`
- `email`
- `address_line1`
- `city`
- `state`
- `zip`
- `move_in_date`
- `banking_checking`
- `banking_savings`
- `banking_prepaid`

Notes:
- `move_in_date` is converted server-side into `residence_months`.
- `customer_name` is returned for the primary applicant.

Response:

```json
{
  "ok": true,
  "person": {},
  "customer_name": "Jane Buyer"
}
```

### `PATCH /api/deals/:dealId/household-income`

Source: `src/app/api/deals/[dealId]/household-income/route.ts`

Toggles whether co-applicant income is included.

Request:

```json
{
  "household_income": true
}
```

Response:

```json
{
  "ok": true,
  "deal": {
    "id": "uuid",
    "household_income": true
  }
}
```

---

## Income

### `GET /api/deals/:dealId/income/:role`

Source: `src/app/api/deals/[dealId]/income/[role]/route.ts`

Returns income profiles for applicant role `primary` or `co`.

Response:

```json
{
  "ok": true,
  "incomes": []
}
```

### `POST /api/deals/:dealId/income/:role`

Source: `src/app/api/deals/[dealId]/income/[role]/route.ts`

Creates a blank income profile for the applicant role.

Allowed `income_type` values:
- `w2`
- `self_employed`
- `fixed`
- `cash`

Request:

```json
{
  "income_type": "w2"
}
```

Response:

```json
{
  "ok": true,
  "income": {}
}
```

### `PATCH /api/deals/:dealId/income/:role/:incomeId`

Source: `src/app/api/deals/[dealId]/income/[role]/[incomeId]/route.ts`

Updates an income profile scoped to the applicant role.

Patchable fields:
- `income_type`
- `applied_to_deal`
- `monthly_gross_manual`
- `monthly_gross_calculated`
- `gross_per_pay`
- `gross_ytd`
- `hire_date`
- `pay_period_end`
- `pay_date`
- `ytd_start_date`
- `ytd_end_date`
- `pay_frequency`
- `manual_notes`
- `calc_flags`

Allowed `pay_frequency` values:
- `weekly`
- `biweekly`
- `semimonthly`
- `monthly`
- `annually`

Response:

```json
{
  "ok": true,
  "income": {}
}
```

### `DELETE /api/deals/:dealId/income/:role/:incomeId`

Source: `src/app/api/deals/[dealId]/income/[role]/[incomeId]/route.ts`

Deletes an income profile scoped to the applicant role.

Response:

```json
{ "ok": true }
```

### `POST /api/deals/:dealId/income/apply`

Source: `src/app/api/deals/[dealId]/income/apply/route.ts`

Calculates applied household income and upserts `underwriting_inputs`.

Behavior:
- sums applied primary income
- includes co-app income only when `deals.household_income` is true
- loads `trivian_config.payment_cap_pct`, defaulting to `0.22`
- writes `gross_monthly_income`, `other_monthly_income`, and `max_payment_pct`

Response includes:

```json
{
  "ok": true,
  "deal_id": "uuid",
  "household_income": true,
  "included": [],
  "totals": {
    "primary_applied": 0,
    "co_applied": 0,
    "gross_monthly_income": 0,
    "max_payment_pct": 0.22,
    "max_payment": 0
  },
  "underwriting_inputs": {}
}
```

---

## Documents and credit bureau

### `GET /api/deals/:dealId/documents`

Source: `src/app/api/deals/[dealId]/documents/route.ts`

Returns deal documents grouped by type.

Document types:
- `credit_bureau`
- `proof_of_income`
- `proof_of_residence`
- `driver_license`
- `insurance`
- `references`
- `other`

Response:

```json
{
  "ok": true,
  "documents": {
    "credit_bureau": null,
    "proof_of_income": [],
    "proof_of_residence": [],
    "driver_license": [],
    "insurance": [],
    "references": [],
    "other": []
  }
}
```

### `POST /api/deals/:dealId/documents`

Source: `src/app/api/deals/[dealId]/documents/route.ts`

Uploads a document through `multipart/form-data`.

Form fields:
- `doc_type`
- `file`

Storage buckets:
- `credit_reports_raw` for `credit_bureau`
- `deal-docs` for all other document types

Rules:
- credit bureau uploads must be PDF
- general docs allow PDF, JPG, JPEG, PNG, WEBP, HEIC, HEIF
- non-bureau docs are blocked if workflow step access fails
- bureau uploads purge old bureau artifacts, supersede active jobs, and queue a new `credit_report_jobs` row

Response:

```json
{
  "ok": true,
  "document": {}
}
```

### `GET /api/deals/:dealId/documents/:documentId`

Source: `src/app/api/deals/[dealId]/documents/[documentId]/route.ts`

Creates a 5-minute signed Supabase Storage URL and redirects to it.

### `DELETE /api/deals/:dealId/documents/:documentId`

Source: `src/app/api/deals/[dealId]/documents/[documentId]/route.ts`

Deletes a document row and storage object.

Notes:
- credit bureau deletes also purge bureau artifacts and jobs
- non-bureau deletes are workflow-gated

Response:

```json
{ "ok": true }
```

### `GET /api/deals/:dealId/credit-bureau-status`

Source: `src/app/api/deals/[dealId]/credit-bureau-status/route.ts`

Returns the most recent `credit_report_jobs` status.

Response:

```json
{
  "ok": true,
  "status": "queued",
  "error_message": null,
  "created_at": "..."
}
```

### `GET /api/deals/:dealId/credit-bureau-details`

Source: `src/app/api/deals/[dealId]/credit-bureau-details/route.ts`

Returns parsed bureau artifacts:
- `credit_reports`
- latest `bureau_summary`
- `bureau_tradelines`
- `bureau_public_records`
- `bureau_messages`

Response:

```json
{
  "ok": true,
  "report": null,
  "summary": null,
  "tradelines": [],
  "publicRecords": [],
  "messages": []
}
```

---

## Underwriting and vehicle options

### `POST /api/deals/:dealId/refresh-underwriting`

Source: `src/app/api/deals/[dealId]/refresh-underwriting/route.ts`

Builds or refreshes `underwriting_results` for stage `bureau_precheck`.

Inputs read server-side:
- latest `bureau_summary`
- primary applicant residence months
- active `underwriting_tier_policy`

Hard stops:
- bureau score below 420
- more than one repo within the last 12 months

Response:

```json
{
  "ok": true,
  "refreshed": true,
  "deal_id": "uuid",
  "result": {}
}
```

### `GET /api/deals/:dealId/vehicles/options`

Source: `src/app/api/deals/[dealId]/vehicles/options/route.ts`

Generates inventory payment options from current underwriting, config, and inventory.

Query params:
- `limit`, default `200`, max `500`
- `offset`, default `0`
- `cashDown`, optional override

Inputs read server-side:
- deal cash/trade fields
- `underwriting_results` at `bureau_precheck`
- `underwriting_inputs`
- latest `trivian_config`
- active `vehicle_term_policy`
- organization inventory

Response:

```json
{
  "ok": true,
  "deal_id": "uuid",
  "count": 0,
  "offset": 0,
  "limit": 200,
  "rows": []
}
```

Each row includes a vehicle snapshot, assumptions, and payment options for:
- `VSC+GAP`
- `VSC`
- `GAP`
- `NONE`

### `GET /api/deals/:dealId/vehicle-selection`

Source: `src/app/api/deals/[dealId]/vehicle-selection/route.ts`

Loads the saved vehicle selection.

Response:

```json
{
  "ok": true,
  "selection": null
}
```

### `POST /api/deals/:dealId/vehicle-selection`

Source: `src/app/api/deals/[dealId]/vehicle-selection/route.ts`

Saves the selected vehicle option.

Request:

```json
{
  "vehicle_id": "uuid",
  "option_label": "VSC+GAP",
  "include_vsc": true,
  "include_gap": true,
  "term_months": 48,
  "monthly_payment": 500,
  "cash_down": 2000
}
```

Allowed `option_label` values:
- `NONE`
- `VSC`
- `GAP`
- `VSC+GAP`

Behavior:
- validates the vehicle exists in current org inventory
- upserts `deal_vehicle_selection`
- deletes existing `deal_structure_inputs` for the deal so live structure inputs reset

Response:

```json
{
  "ok": true,
  "selection": {}
}
```

### `GET /api/deals/:dealId/deal-structure`

Source: `src/app/api/deals/[dealId]/deal-structure/route.ts`

Loads deal structure page data using `loadDealStructurePageData`.

Notes:
- Requires selected vehicle access via `canAccessStep`
- Can return `404` when deal or vehicle selection is missing

---

## Override workflow

### `POST /api/deals/:dealId/override-requests`

Source: `src/app/api/deals/[dealId]/override-requests/route.ts`

Creates or directly approves an override request for the current live deal structure.

Request fields:
- `action`: `request` or `approve`
- `blocker_code`
- `requested_note`
- `counter_offer_draft`

Rules:
- requester must be authenticated
- current org membership must match the deal org
- direct approval requires dealership permission `approve_overrides`
- override notes are required except for authorized counter-offer drafts

Response:

```json
{
  "ok": true,
  "request": {}
}
```

### `POST /api/deals/:dealId/override-requests/:requestId/review`

Source: `src/app/api/deals/[dealId]/override-requests/[requestId]/review/route.ts`

Reviews an override request.

Request fields:
- `status`: `approved`, `denied`, or `countered`
- `review_note`
- `counter_type`: required for counter offers
- `counter_offer.inputs`: required for counter offers

Allowed `counter_type` values:
- `improve_approval`
- `reduce_risk`
- `pricing_adjustment`

Rules:
- reviewer must have dealership permission `approve_overrides`
- denied and countered reviews require a note
- counter offers preview a structure without persisting, then store inputs/output snapshots

Response:

```json
{
  "ok": true
}
```

Additional fields come from `reviewDealOverrideRequest`.

### `POST /api/deals/:dealId/override-requests/:requestId/preview-counter`

Source: `src/app/api/deals/[dealId]/override-requests/[requestId]/preview-counter/route.ts`

Previews counter-offer structure inputs without persisting.

Request:

```json
{
  "counter_offer": {
    "inputs": {}
  }
}
```

Response:

```json
{
  "ok": true,
  "preview": {}
}
```

### `POST /api/deals/:dealId/override-requests/:requestId/accept-counter`

Source: `src/app/api/deals/[dealId]/override-requests/[requestId]/accept-counter/route.ts`

Accepts the latest counter offer and persists the refreshed deal structure.

Response includes:

```json
{
  "acceptedCounterOfferId": "uuid"
}
```

Additional fields come from `loadDealStructurePageData`.

---

## Submit and funding

### `POST /api/deals/:dealId/submit`

Source: `src/app/api/deals/[dealId]/submit/route.ts`

Submits a deal for funding review.

Request:

```json
{
  "funding_notes": "...",
  "internal_notes": "..."
}
```

Server-side readiness checks:
- authenticated user
- workflow access for submit step
- saved deal structure exists
- selected vehicle still exists in inventory
- credit bureau document exists
- required stip docs exist:
  - `proof_of_income`
  - `proof_of_residence`
  - `driver_license`
- effective override blockers are resolved

On success, updates:
- `funding_notes`
- `internal_notes`
- `submitted_at`
- `submitted_by`
- `submit_status = submitted`
- `workflow_status = submitted_complete`
- `current_step = 6`

Response:

```json
{
  "ok": true,
  "deal_id": "uuid",
  "submitted_at": "...",
  "submitted_by": "uuid",
  "submit_status": "submitted",
  "next_step": 6
}
```

### `GET /api/deals/:dealId/fund`

Source: `src/app/api/deals/[dealId]/fund/route.ts`

Loads the funding packet.

Response includes:
- `deal`
- selected structure as `selection`
- `overrides`
- grouped `documents`
- `stips`
- `current_structure_fingerprint`
- `checklist`

Response:

```json
{
  "ok": true,
  "deal": {},
  "selection": null,
  "overrides": null,
  "documents": {},
  "stips": [],
  "current_structure_fingerprint": "...",
  "checklist": {}
}
```

### `PATCH /api/deals/:dealId/fund`

Source: `src/app/api/deals/[dealId]/fund/route.ts`

Performs funding review actions.

Auth:
- authenticated user required
- current org role must have `fund_deal`

Allowed `action` values:
- `verify_stip`
- `reject_stip`
- `reject_funding`
- `fund`
- `fund_with_income_change`
- `send_back_to_underwriter`

#### Verify stip

Request:

```json
{
  "action": "verify_stip",
  "doc_type": "proof_of_income"
}
```

Allowed `doc_type` values:
- `proof_of_income`
- `proof_of_residence`
- `driver_license`

Response:

```json
{
  "ok": true,
  "verification": {}
}
```

#### Reject stip

Request:

```json
{
  "action": "reject_stip",
  "doc_type": "proof_of_income",
  "rejection_reason": "...",
  "verified_monthly_income": 3000
}
```

Notes:
- `rejection_reason` is required.
- `verified_monthly_income` is required when rejecting proof of income.

#### Reject funding

Request:

```json
{
  "action": "reject_funding",
  "reason": "..."
}
```

Response:

```json
{
  "ok": true,
  "funding_status": "rejected"
}
```

#### Fund

Request:

```json
{
  "action": "fund"
}
```

Requires all current required stips to be verified and no active funding rejection.

Response:

```json
{
  "ok": true,
  "funding_status": "funded",
  "funded_at": "..."
}
```

#### Fund with income change

Request:

```json
{
  "action": "fund_with_income_change"
}
```

Requires proof of income to be rejected with a verified monthly income value.

Response:

```json
{
  "ok": true,
  "funding_status": "funded_with_changes",
  "funded_at": "..."
}
```

#### Send back to underwriter

Request:

```json
{
  "action": "send_back_to_underwriter",
  "reason": "..."
}
```

Updates the deal back to vehicle/underwriting workflow state.

Response:

```json
{
  "ok": true,
  "funding_status": "restructure_requested"
}
```

---

## Route inventory

Current route handlers:

- `POST /api/deals`
- `GET /api/deals/:dealId`
- `PATCH /api/deals/:dealId`
- `GET /api/deals/:dealId/credit-bureau-details`
- `GET /api/deals/:dealId/credit-bureau-status`
- `POST /api/deals/:dealId/customer`
- `GET /api/deals/:dealId/deal-structure`
- `GET /api/deals/:dealId/documents`
- `POST /api/deals/:dealId/documents`
- `GET /api/deals/:dealId/documents/:documentId`
- `DELETE /api/deals/:dealId/documents/:documentId`
- `GET /api/deals/:dealId/fund`
- `PATCH /api/deals/:dealId/fund`
- `PATCH /api/deals/:dealId/household-income`
- `POST /api/deals/:dealId/income/apply`
- `GET /api/deals/:dealId/income/:role`
- `POST /api/deals/:dealId/income/:role`
- `PATCH /api/deals/:dealId/income/:role/:incomeId`
- `DELETE /api/deals/:dealId/income/:role/:incomeId`
- `POST /api/deals/:dealId/override-requests`
- `POST /api/deals/:dealId/override-requests/:requestId/accept-counter`
- `POST /api/deals/:dealId/override-requests/:requestId/preview-counter`
- `POST /api/deals/:dealId/override-requests/:requestId/review`
- `GET /api/deals/:dealId/people`
- `PATCH /api/deals/:dealId/people/:role`
- `POST /api/deals/:dealId/refresh-underwriting`
- `POST /api/deals/:dealId/submit`
- `GET /api/deals/:dealId/vehicle-selection`
- `POST /api/deals/:dealId/vehicle-selection`
- `GET /api/deals/:dealId/vehicles/options`
- `GET /api/health`
- `HEAD /api/health`
- `POST /api/logout`

---

## Tables touched by API routes

The API routes read or write these main tables:

- `organizations`
- `deals`
- `deal_people`
- `income_profiles`
- `underwriting_inputs`
- `underwriting_results`
- `deal_documents`
- `credit_report_jobs`
- `credit_reports`
- `bureau_summary`
- `bureau_tradelines`
- `bureau_public_records`
- `bureau_messages`
- `deal_vehicle_selection`
- `deal_structure`
- `deal_structure_inputs`
- `deal_funding_stip_verifications`
- `trivian_inventory`
- `trivian_config`
- `vehicle_term_policy`
- `underwriting_tier_policy`

---

## Implementation notes

- Most deal endpoints start by proving the deal belongs to the current organization.
- Child data queries must include `organization_id` and, when applicable, `deal_id`.
- Funding and override APIs layer app permissions on top of tenant checks.
- Credit bureau uploads create async work through `credit_report_jobs`; the sidecar worker processes those jobs.
- Document download is implemented as a redirect to a short-lived signed Supabase Storage URL.
- Vehicle options are generated dynamically; saved structure/selection APIs should continue to use existing deal-structure loader and engine helpers.
