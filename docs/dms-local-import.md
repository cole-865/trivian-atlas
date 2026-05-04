# Local DMS Import Test Path

Use this workflow to manually test `POST /api/dms/import` against local Atlas and local Supabase with real DMS CSV exports.

Do not paste CSV content into logs, tickets, or chat. The script prints only the sanitized import summary returned by the API.

## Prerequisites

1. Start local Supabase and apply migrations.
2. Start Atlas locally:

```bash
npm run dev
```

3. Sign in at `http://localhost:3000` as a user with:
   - a current organization selected
   - `manage_integrations` permission

4. In browser devtools, copy the request `Cookie` header from a request to `http://localhost:3000`.

Do not copy or use production cookies. Do not commit cookies. If authentication fails, get a fresh localhost cookie from the browser.

## Import Commands

All commands default to `http://localhost:3000/api/dms/import`.

```bash
npm run dms:import:local -- --report-type all_accounts --file "C:\Users\coleh\Downloads\All Accounts - IQ (2).csv" --cookie "<localhost cookie>"
```

```bash
npm run dms:import:local -- --report-type payment_ledger --file "C:\Users\coleh\Downloads\Payment Ledger - IQ (1).csv" --cookie "<localhost cookie>"
```

```bash
npm run dms:import:local -- --report-type bhph_activities --file "C:\Users\coleh\Downloads\BHPH Activities - IQ (3).csv" --cookie "<localhost cookie>"
```

The script refuses to post to non-local URLs by default. If a non-local dev target is intentional, pass both `--url` and `--allow-non-local`:

```bash
npm run dms:import:local -- --report-type all_accounts --file "C:\path\to\file.csv" --cookie "<cookie>" --url "https://dev.example.test" --allow-non-local
```

## Verification SQL

Replace `<batch_id>` with the `batch_id` printed by the script.

Confirm the batch:

```sql
select id, organization_id, report_type, source_filename, row_count, status, imported_at
from public.dms_import_batches
where id = '<batch_id>';
```

Confirm raw rows landed in the expected table:

```sql
select count(*) as account_snapshot_rows
from public.dms_accounts_snapshot
where import_batch_id = '<batch_id>';
```

```sql
select count(*) as payment_ledger_rows
from public.dms_payment_ledger
where import_batch_id = '<batch_id>';
```

```sql
select count(*) as activity_event_rows
from public.dms_activity_events
where import_batch_id = '<batch_id>';
```

Confirm derived views return rows without selecting customer-identifying fields:

```sql
with imported_deals as (
  select organization_id, deal_number
  from public.dms_accounts_snapshot
  where import_batch_id = '<batch_id>'
)
select count(*) as payment_signal_rows
from public.account_payment_signals v
where exists (
  select 1
  from imported_deals d
  where d.organization_id = v.organization_id
    and d.deal_number = v.deal_number
);
```

```sql
with imported_deals as (
  select organization_id, deal_number
  from public.dms_accounts_snapshot
  where import_batch_id = '<batch_id>'
)
select count(*) as collections_signal_rows
from public.account_collections_signals v
where exists (
  select 1
  from imported_deals d
  where d.organization_id = v.organization_id
    and d.deal_number = v.deal_number
);
```

```sql
with imported_deals as (
  select organization_id, deal_number
  from public.dms_accounts_snapshot
  where import_batch_id = '<batch_id>'
)
select count(*) as repo_signal_rows
from public.account_repo_signals v
where exists (
  select 1
  from imported_deals d
  where d.organization_id = v.organization_id
    and d.deal_number = v.deal_number
);
```

```sql
with imported_deals as (
  select organization_id, deal_number
  from public.dms_accounts_snapshot
  where import_batch_id = '<batch_id>'
)
select count(*) as outcome_rows
from public.account_outcomes v
where exists (
  select 1
  from imported_deals d
  where d.organization_id = v.organization_id
    and d.deal_number = v.deal_number
);
```

Confirm app-safe views do not expose `raw_data`:

```sql
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'account_payment_signals',
    'account_collections_signals',
    'account_repo_signals',
    'account_outcomes'
  )
  and column_name = 'raw_data';
```

Expected result: zero rows.

## Notes

- The script uses the real authenticated endpoint. It does not bypass auth.
- The script does not support storage-path imports; n8n orchestration comes later.
- The API and script never return or print `raw_data`.
