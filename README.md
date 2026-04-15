# Atlas

Atlas is a multi-tenant loan origination and underwriting system for independent dealerships.

## Stack

- Next.js App Router
- TypeScript
- Supabase Auth
- Supabase Postgres
- Supabase RLS
- Sidecar credit worker for bureau parsing and underwriting staging

## Workspaces

- Web app: `C:\dev\atlas`
- Credit worker: `C:\dev\atlas\services\credit-worker`

## Environment

### Web app

Required for normal app startup:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Required for organization management, invites, impersonation support, and platform admin flows:

- `SUPABASE_SERVICE_ROLE_KEY`

Optional but recommended for invite delivery:

- `NEXT_PUBLIC_SITE_URL`
- `RESEND_API_KEY`
- `EMAIL_FROM`

Optional for model-backed decision assist:

- `OPENAI_API_KEY`
- `OPENAI_DECISION_ASSIST_MODEL` (optional, defaults to `gpt-4o-mini`)

### Credit worker

Expected in `services/credit-worker/.env`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REDACTED_BUCKET` (optional, defaults to `credit_reports_redacted`)

## Local Development

### Install dependencies

```bash
npm install
cd services/credit-worker
npm install
```

### Start the web app

```bash
npm run dev
```

The app runs at `http://localhost:3000`.

### Enable model-backed decision assist

If you want the deal AI Review panel to use OpenAI for summary and recommendation wording instead of the deterministic fallback only, add these to `.env.local`:

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_DECISION_ASSIST_MODEL=gpt-4o-mini
```

Without `OPENAI_API_KEY`, Atlas falls back to the deterministic decision-assist logic and still renders the review panel when trigger conditions are met.

### Start the credit worker

```bash
cd services/credit-worker
npm run build
npm start
```

The worker listens for `credit_report_jobs` changes and processes bureau uploads into redacted artifacts, parsed bureau tables, and `underwriting_results`.

## Project Checks

Run these before finishing implementation work:

```bash
npm run lint
npm run typecheck
npm test
```

Optional real-backend smoke tests against a disposable Supabase project:

```bash
$env:RUN_SUPABASE_INTEGRATION="1"
npm run test:integration
```

Use this only against a disposable or explicitly approved environment. The integration harness creates and then cleans up temporary organizations, memberships, and invites.

Additional app verification:

```bash
npm run build
```

If `npm run build` fails with `EPERM` while removing files in `.next`, stop any running `node` or `next dev` process first and retry. This repo currently hits that on Windows when build artifacts are locked.

## Multi-Tenant Rules

- All business data must remain organization-scoped.
- Current organization is resolved through the existing org context and cookie helpers.
- Platform dev is a global role, not a normal org-managed role.
- Org-managed UI roles must stay limited to `sales`, `management`, and `admin`.
- Removing a user from an organization means deactivating membership, not deleting the auth user.
- Invitation tokens must be hashed at rest and expire after 7 days.

## Primary Flows In Repo

- Organization switcher in the global app chrome
- Platform dev organization creation seeded from `865-autos`
- Org-scoped user and invite management in Settings
- Invite acceptance flow at `/invite/accept`
- Platform-only impersonation tools
- Deal creation, editing, document upload, bureau processing, and underwriting refresh

## Docs

- Architecture: `docs/atlas-architecture.md`
- Tenant audit: `docs/tenant-boundary-audit.md`
- Supabase migration guidance: `docs/supabase/multi-tenant-next-targets.md`
- Org management SQL: `docs/supabase/organization-management.sql`
