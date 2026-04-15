# Atlas Architecture

## Overview

Atlas is a multi-tenant dealership LOS built around Supabase Auth, organization memberships, and organization-scoped business data. The web app owns user-facing workflows and the credit worker handles asynchronous bureau parsing and underwriting staging.

## Auth Model

- Authentication uses Supabase Auth and must not be replaced.
- User profile and role metadata are loaded from `public.user_profiles` with a transitional fallback to auth metadata where older rows may still exist.
- `dev` is a global platform role.
- `sales`, `management`, and `admin` are organization-managed roles.

## Organization Context

- Current organization is stored in the `atlas_current_organization_id` cookie.
- Organization resolution is handled in `src/lib/auth/organizationContext.ts`.
- Normal users can operate only within active memberships.
- Platform dev can switch into any organization and can still resolve a current organization even without a direct active membership when using admin access.

## Authorization Layers

### Application layer

- `src/lib/auth/userRole.ts` builds the effective auth context.
- `src/lib/auth/organizationManagement.ts` contains organization-level permission helpers and invite/org-management flows.
- `src/lib/auth/accessRules.ts` holds pure boundary rules used by server actions and tests.
- Deal and underwriting routes use org-aware helpers in `src/lib/deals` and `src/lib/los`.

### Database layer

- Business tables are expected to be organization-scoped with matching RLS.
- Migration planning is documented in `docs/supabase/multi-tenant-next-targets.md`.
- Org-management indexes and invitation table setup live in `docs/supabase/organization-management.sql`.

## Core Multi-Tenant Flows

### Organization switching

- The global switcher lives in the top-right app chrome.
- Switching writes the current org cookie through `setCurrentOrganizationAction`.
- Only organizations visible through the existing auth context are allowed targets.

### Organization management

- Settings page shows account context, active users, inactive users, and pending invites.
- Only org admins in the current organization and platform dev can manage account users.
- Inactive memberships stay hidden by default unless explicitly requested.

### Invitations

- Invitations are organization-specific.
- Stored fields include target email, role, inviter, token hash, status, and expiration.
- Invite acceptance verifies status, expiry, and invited email match before activating membership.

### Platform dev tools

- Platform dev can create organizations, activate/deactivate organizations, switch across organizations, and impersonate users.
- New organizations are seeded from `865-autos` defaults and immediately create an initial admin invite.

## Deal Workflow Boundaries

- Deals are the primary tenant boundary for the LOS workflow.
- Child tables such as `deal_people`, `income_profiles`, `deal_documents`, `deal_structure`, `deal_vehicle_selection`, `underwriting_inputs`, and `underwriting_results` are queried through organization-aware helpers or explicit `organization_id` filters.
- Bureau detail tables (`bureau_summary`, `bureau_tradelines`, `bureau_public_records`, `bureau_messages`) are organization-scoped and tied back to a deal.

## Credit Worker Responsibilities

The worker in `services/credit-worker`:

- listens for `credit_report_jobs`
- downloads raw bureau PDFs
- extracts and redacts text
- uploads redacted PDFs
- upserts `credit_reports`
- replaces bureau detail records
- upserts `underwriting_results` for the `bureau_precheck` stage

The worker propagates `organization_id` across every downstream row it writes.

## Verification Expectations

Before finishing implementation work, run:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build` when no local process is locking `.next`

## Current Gaps

- The repo now has lightweight boundary tests, but not full integration coverage for server actions and route handlers.
- `trivian_config` still contains a transitional fallback for global rows with `organization_id is null`.
- The credit worker should get its own dedicated audit and test pass if bureau processing is on the critical path.
