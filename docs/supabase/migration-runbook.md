# Supabase Migration Runbook

This project has a live Supabase database whose schema predates reliable
tracking in `supabase_migrations.schema_migrations`. Because of that, do not
blindly run `supabase db push` against production until the remote migration
history has been repaired to match the repo.

## Current canonical migration set

These are the migration versions that should be recorded as applied in the
linked live project:

- `20260410`
- `20260413`
- `20260413222111`
- `20260414000100`
- `20260419230000`
- `20260419233000`

Notes:

- `20260413_add_verified_monthly_income_to_funding_stips.sql` was removed
  because it duplicated version `20260413` and was redundant. The funding
  workflow migration already creates `verified_monthly_income`.
- `20260419230000` and `20260419233000` were applied manually in the Supabase
  SQL editor before the remote migration history was repaired.

## One-time repair

Run this from the repo root after confirming the linked project is correct:

```bash
supabase migration repair --status applied \
  20260410 \
  20260413 \
  20260413222111 \
  20260414000100 \
  20260419230000 \
  20260419233000
```

Then verify:

```bash
supabase migration list
```

Expected result: the `Remote` column should list the same versions as `Local`.

## Going forward

1. Create new migrations with unique timestamps.
2. Apply normal forward-only changes with `supabase db push` once the repair is
   complete.
3. If you must hotfix production manually in the SQL editor:
   - add the same SQL as a repo migration immediately after
   - repair or mark the migration history deliberately
   - do not leave repo and remote drift unresolved

## Rules for future migrations

- Never create two files with the same migration version.
- Prefer full timestamps over date-only versions.
- Keep data backfills idempotent when possible.
- Treat `supabase migration list` as part of release verification.
