# AGENTS.md

## Agent expectations

- Follow this file strictly
- If unsure, prefer existing patterns over new implementations
- Do not invent new business logic
- Ask for clarification instead of guessing

## Project
Trivian Atlas is a multi-tenant loan origination and underwriting system for independent dealerships.

## Stack
- Next.js App Router
- TypeScript
- Supabase Auth
- Supabase Postgres
- Supabase RLS

## Core architecture rules
- Do not redesign authentication.
- Do not replace Supabase Auth.
- Do not introduce a second permissions system.
- Reuse existing organization context, role, permissions, and impersonation helpers.
- Build on current multi-tenant foundations already in the repo.
- Keep changes localized.
- Do not touch unrelated workflows.

## Multi-tenant rules
- All business data must remain organization-scoped.
- Current organization is determined by existing org context/cookie helpers.
- Only platform dev can do cross-organization actions.
- Organization admins can only manage users, invites, and settings in their own organization.
- Org-managed roles exposed in UI must only be:
  - sales
  - management
  - admin
- Never expose `dev` as an assignable org role in normal user management UI.
- “Removing” a user from an organization means deactivating that organization membership.
- Do not hard-delete auth users as part of org user management.
- A single auth user may belong to multiple organizations.

## Platform dev rules
- Platform dev is a global role/check, not a normal org-managed role.
- Platform dev can:
  - see all organizations
  - switch into any organization
  - create organizations
  - access dev/debug tools
  - impersonate any user
  - manage users across organizations where needed

## Invitation rules
- Build invites as a real flow, not a placeholder.
- Invitations must be organization-specific.
- Invitations must have:
  - target email
  - target role
  - inviter
  - token
  - status
  - expiration
- Invite expiration: 7 days
- Suggested statuses:
  - pending
  - accepted
  - expired
  - revoked
- Store hashed invite tokens, not raw tokens.
- Admins can only create/resend/revoke invites within their own organization.
- Platform dev can manage invites across organizations.

## Organization creation rules
- Only platform dev can create organizations.
- New organizations must not be left empty.
- On creation, seed defaults from `865-autos`.
- Clone into the new organization:
  - vehicle_term_policy
  - underwriting_tier_policy
  - trivian_config
- Creating a new organization must also create an invite for the initial org admin.
- New organization creation should switch current org context to the new org.

## Settings boundaries
- All dealership operational settings must remain organization-scoped.
- Examples:
  - underwriting settings
  - vehicle term policy
  - underwriting tier policy
  - config values
- Dev/debug tools must remain separate from org-owned settings.

## UI guidance
- Keep UI simple and production-clean.
- No overdesign.
- Prefer extending existing settings and header patterns.
- Org switcher belongs in the top-right/global app chrome.
- Inactive users should be hidden by default and shown only when explicitly toggled.
- Pending invites should be visible in user management.

## Preferred implementation style
- Inspect existing helpers before coding.
- Follow established naming and file patterns in the repo.
- Prefer small helper additions over new abstractions.
- Prefer server-safe authorization checks.
- Reuse existing org-aware scoping helpers wherever possible.
- Avoid speculative refactors.

## Expected verification
Before finishing, run the project checks that exist in this repo.

At minimum, identify and run the relevant commands for:
- dev/start
- lint
- typecheck
- tests, if present

## Deliverables for implementation tasks
When finished, report:
1. Summary of what was implemented
2. Exact changed files
3. New routes/actions/helpers added
4. Schema or migration changes
5. Assumptions or limitations
6. Manual test steps

## Underwriting domain rules

- Max term: 60 months
- Base PTI: 22%, but may be reduced based on risk tier
- APR default: ~26.99%–28.99% depending on context
- Taxes and fees must be included in amount financed
- VSC and GAP affect term eligibility:
  - With VSC + GAP → full term allowed
  - Without → term may be reduced
- LTV is based on JD Power book values
- Payment must respect PTI cap derived from income step
- All deal structures must pass:
  - PTI
  - LTV
  - Max amount financed
  - Max vehicle price

- If a deal does not structure:
  - Calculate additional down required
  - Return normalized fail reasons:
    - PTI
    - LTV
    - AMOUNT_FINANCED
    - VEHICLE_PRICE

## Data safety rules

- Never expose cross-organization data
- Always filter queries by organization_id
- Never trust client-provided organization_id
- Always derive organization from server-side context
- Do not bypass RLS without explicit server-side reasoning

## Supabase migration workflow

- Default to tracked repo migrations plus `supabase db push` for schema changes.
- Use the Supabase SQL editor only for read-only inspection or urgent manual hotfixes.
- If a manual SQL change is made in Supabase, immediately mirror it into a tracked repo migration and repair migration history if needed.
