begin;

create or replace function public.dms_parse_numeric(raw_value text)
returns numeric
language sql
immutable
as $$
  with cleaned as (
    select
      btrim(coalesce(raw_value, '')) as original_value,
      regexp_replace(btrim(coalesce(raw_value, '')), '[\$,()%\s]', '', 'g') as cleaned_value
  )
  select case
    when original_value = '' then null
    when lower(original_value) in ('n/a', 'na', 'unknown', 'null', 'none') then null
    when cleaned_value in ('', '--', '-', '.', '-.', '+', '+.') then null
    when cleaned_value !~ '^[+-]?((\d+(\.\d*)?)|(\.\d+))$' then null
    else (
      case
        when original_value ~ '^\(.*\)$' then -1
        else 1
      end
    ) * cleaned_value::numeric
  end
  from cleaned;
$$;

create or replace function public.dms_parse_date(raw_value text)
returns date
language sql
immutable
as $$
  select case
    when raw_value is null or btrim(raw_value) = '' then null
    when btrim(raw_value) ~ '^\d{1,2}/\d{1,2}/\d{4}' then to_date(split_part(btrim(raw_value), ' ', 1), 'MM/DD/YYYY')
    else null
  end;
$$;

create or replace function public.dms_parse_timestamptz(raw_value text)
returns timestamptz
language plpgsql
stable
as $$
begin
  if raw_value is null or btrim(raw_value) = '' then
    return null;
  end if;

  begin
    return btrim(raw_value)::timestamptz;
  exception
    when others then
      begin
        return to_timestamp(btrim(raw_value), 'MM/DD/YYYY HH12:MI:SS AM')::timestamptz;
      exception
        when others then
          begin
            return to_timestamp(btrim(raw_value), 'MM/DD/YYYY')::timestamptz;
          exception
            when others then
              return null;
          end;
      end;
  end;
end;
$$;

create or replace function public.dms_parse_boolean(raw_value text)
returns boolean
language sql
immutable
as $$
  select case lower(btrim(coalesce(raw_value, '')))
    when 'true' then true
    when 'yes' then true
    when 'y' then true
    when '1' then true
    when 'false' then false
    when 'no' then false
    when 'n' then false
    when '0' then false
    else null
  end;
$$;

create or replace function public.dms_payment_frequency_days(raw_value text)
returns integer
language sql
immutable
as $$
  select case
    when raw_value is null or btrim(raw_value) = '' then null
    when lower(btrim(raw_value)) like '%semi%month%' then 15
    when lower(btrim(raw_value)) like '%semimonth%' then 15
    when lower(btrim(raw_value)) like '%bi%week%' then 14
    when lower(btrim(raw_value)) like '%every 2 week%' then 14
    when lower(btrim(raw_value)) like '%weekly%' then 7
    when lower(btrim(raw_value)) like '%month%' then 30
    else null
  end;
$$;

create or replace function public.dms_hash_part(raw_value text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(lower(btrim(raw_value)), ''), '<null>');
$$;

create table if not exists public.dms_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_type text not null check (report_type in ('all_accounts', 'payment_ledger', 'bhph_activities')),
  source_filename text null,
  source_headers jsonb null,
  imported_by_user_id uuid null references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  row_count integer null check (row_count is null or row_count >= 0),
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  notes text null,
  raw_metadata jsonb null,
  created_at timestamptz not null default now()
);

create table if not exists public.dms_accounts_snapshot (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_batch_id uuid not null references public.dms_import_batches(id) on delete cascade,
  snapshot_date date not null default current_date,
  deal_number text not null,
  lender_name text null,
  lender_type text null,
  account_status text null,
  account_closed_date date null,
  charge_off_date date null,
  charge_off_reason text null,
  bad_debt_amount numeric null,
  principal_bad_debt_amount numeric null,
  deal_date date null,
  first_payment_date date null,
  original_due_date date null,
  new_due_date date null,
  payment_end_date date null,
  payment_frequency text null,
  apr numeric null,
  original_financed_amount numeric null,
  original_financed_charge numeric null,
  total_payment_amount numeric null,
  remaining_payment numeric null,
  final_payment_amount numeric null,
  previous_payment_amount numeric null,
  payment_status text null,
  auto_pay_status text null,
  days_past_due integer null,
  total_past_due_amount numeric null,
  total_payment_due_amount numeric null,
  principal_due_amount numeric null,
  interest_due_amount numeric null,
  late_due_amount numeric null,
  other_due_amount numeric null,
  side_note_due_amount numeric null,
  down_due_amount numeric null,
  credit_due_amount numeric null,
  last_paid_date date null,
  last_paid_amount numeric null,
  balance_principal_amount numeric null,
  interest_balance_amount numeric null,
  late_balance_amount numeric null,
  other_balance_amount numeric null,
  balance_side_note_amount numeric null,
  balance_down_amount numeric null,
  tax_balance_amount numeric null,
  total_payoff_amount numeric null,
  total_paid_amount numeric null,
  total_paid_without_down_side_note numeric null,
  principal_paid_amount numeric null,
  interest_paid_amount numeric null,
  total_late_fees_paid_amount numeric null,
  total_other_fees_paid_amount numeric null,
  total_side_note_paid_amount numeric null,
  total_down_paid_amount numeric null,
  collector_name text null,
  last_contacted_date date null,
  next_call_back_date date null,
  promise_amount numeric null,
  promise_created_date date null,
  promise_date date null,
  promise_note text null,
  promised_result text null,
  notes text null,
  num_of_extensions integer null,
  num_of_loan_modification integer null,
  loan_modification_date date null,
  loan_modification_reason text null,
  collateral_status text null,
  repo_status text null,
  repo_stage text null,
  repo_type text null,
  repo_reason text null,
  out_for_repo_date date null,
  repo_created_date date null,
  repo_completed_date date null,
  last_repo_date date null,
  cured_date date null,
  repo_company_name text null,
  repo_fees numeric null,
  repo_location text null,
  recovery_amount numeric null,
  recovery_without_repo_credit numeric null,
  repo_credit numeric null,
  account_sell_date date null,
  account_sale_received_amount numeric null,
  buy_back_date date null,
  buy_back_cost numeric null,
  buy_back_reason text null,
  vehicle_year_make_model text null,
  vehicle_vin text null,
  vin_last_six text null,
  vehicle_stock_number text null,
  vehicle_mileage integer null,
  vehicle_price numeric null,
  vehicle_cost numeric null,
  vehicle_exterior_color text null,
  vehicle_fuel_type text null,
  gps_provider text null,
  gps_tracking_number text null,
  current_insurance_carrier text null,
  current_insurance_effective_date date null,
  current_insurance_expiry_date date null,
  insurance_status text null,
  down_amount numeric null,
  total_down_amount numeric null,
  total_cash_in_deal numeric null,
  net_cash_in_deal numeric null,
  total_price numeric null,
  total_gross numeric null,
  front_gross_amount numeric null,
  backend_gross_amount numeric null,
  dealer_gross_amount numeric null,
  net_profit numeric null,
  exposure numeric null,
  num_of_payments_till_break_even integer null,
  custom_account_status text null,
  account_conditions text null,
  raw_data jsonb not null,
  created_at timestamptz not null default now(),
  unique (import_batch_id, deal_number)
);

create table if not exists public.dms_payment_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_batch_id uuid not null references public.dms_import_batches(id) on delete cascade,
  transaction_hash text not null,
  deal_number text not null,
  paid_date date null,
  paid_amount numeric null,
  transaction_type text null,
  late_fee_amount numeric null,
  period_num text null,
  ref_num text null,
  last_updated_by_name text null,
  last_updated_date timestamptz null,
  is_ach_returned boolean null,
  is_auto_nsf boolean null,
  account_conditions text null,
  days_late integer null,
  balance_amount numeric null,
  collector_name text null,
  deal_status text null,
  late_fees_applied_amt numeric null,
  other_fees_applied_amt numeric null,
  interest_applied_amt numeric null,
  principal_applied_amt numeric null,
  credit_applied_amt numeric null,
  side_note_applied_amt numeric null,
  down_applied_amt numeric null,
  due_amount numeric null,
  account_status text null,
  other_fees_due_amount numeric null,
  interest_due_amount numeric null,
  principal_due_amount numeric null,
  side_note_due_amount numeric null,
  processing_fee_due_amount numeric null,
  is_reversal boolean not null default false,
  positive_payment_amount numeric null,
  reversal_amount numeric null,
  raw_data jsonb not null,
  created_at timestamptz not null default now(),
  unique (organization_id, transaction_hash)
);

create table if not exists public.dms_activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_batch_id uuid not null references public.dms_import_batches(id) on delete cascade,
  event_hash text not null,
  deal_number text not null,
  customer_name text null,
  activity_status text null,
  activity_type text null,
  disposition text null,
  subject text null,
  assigned_rep_on_activity text null,
  collector text null,
  account_status text null,
  created_date timestamptz null,
  last_updated_date timestamptz null,
  last_updated_by text null,
  promise_amount numeric null,
  promise_date date null,
  promised_result text null,
  payment_due_date date null,
  is_sms boolean not null default false,
  is_email boolean not null default false,
  is_call boolean not null default false,
  is_inbound boolean not null default false,
  is_outbound boolean not null default false,
  has_promise boolean not null default false,
  promise_kept boolean not null default false,
  promise_broken boolean not null default false,
  raw_data jsonb not null,
  created_at timestamptz not null default now(),
  unique (organization_id, event_hash)
);

create index if not exists dms_import_batches_org_imported_idx
  on public.dms_import_batches (organization_id, imported_at desc);

create index if not exists dms_import_batches_report_idx
  on public.dms_import_batches (organization_id, report_type, imported_at desc);

create index if not exists dms_accounts_snapshot_org_deal_snapshot_idx
  on public.dms_accounts_snapshot (organization_id, deal_number, snapshot_date desc, created_at desc);

create index if not exists dms_accounts_snapshot_import_batch_idx
  on public.dms_accounts_snapshot (import_batch_id);

create index if not exists dms_accounts_snapshot_status_idx
  on public.dms_accounts_snapshot (organization_id, account_status);

create index if not exists dms_accounts_snapshot_repo_status_idx
  on public.dms_accounts_snapshot (organization_id, repo_status);

create index if not exists dms_accounts_snapshot_charge_off_idx
  on public.dms_accounts_snapshot (organization_id, charge_off_date);

create index if not exists dms_accounts_snapshot_snapshot_date_idx
  on public.dms_accounts_snapshot (organization_id, snapshot_date desc);

create index if not exists dms_payment_ledger_org_deal_paid_idx
  on public.dms_payment_ledger (organization_id, deal_number, paid_date desc);

create index if not exists dms_payment_ledger_import_batch_idx
  on public.dms_payment_ledger (import_batch_id);

create index if not exists dms_payment_ledger_paid_date_idx
  on public.dms_payment_ledger (organization_id, paid_date desc);

create index if not exists dms_payment_ledger_transaction_hash_idx
  on public.dms_payment_ledger (transaction_hash);

create index if not exists dms_activity_events_org_deal_created_idx
  on public.dms_activity_events (organization_id, deal_number, created_date desc);

create index if not exists dms_activity_events_import_batch_idx
  on public.dms_activity_events (import_batch_id);

create index if not exists dms_activity_events_created_date_idx
  on public.dms_activity_events (organization_id, created_date desc);

create index if not exists dms_activity_events_event_hash_idx
  on public.dms_activity_events (event_hash);

alter table public.dms_import_batches enable row level security;
alter table public.dms_accounts_snapshot enable row level security;
alter table public.dms_payment_ledger enable row level security;
alter table public.dms_activity_events enable row level security;

create policy "dms_import_batches_select_raw_managers"
on public.dms_import_batches
for select
to authenticated
using (
  public.has_organization_role(organization_id, array['management', 'admin'])
  or public.current_app_role() = 'dev'
);

create policy "dms_import_batches_insert_admins"
on public.dms_import_batches
for insert
to authenticated
with check (
  public.has_organization_role(organization_id, array['admin'])
  or public.current_app_role() = 'dev'
);

create policy "dms_import_batches_update_admins"
on public.dms_import_batches
for update
to authenticated
using (
  public.has_organization_role(organization_id, array['admin'])
  or public.current_app_role() = 'dev'
)
with check (
  public.has_organization_role(organization_id, array['admin'])
  or public.current_app_role() = 'dev'
);

create policy "dms_import_batches_delete_dev_only"
on public.dms_import_batches
for delete
to authenticated
using (public.current_app_role() = 'dev');

create policy "dms_accounts_snapshot_select_raw_managers"
on public.dms_accounts_snapshot
for select
to authenticated
using (
  public.has_organization_role(organization_id, array['management', 'admin'])
  or public.current_app_role() = 'dev'
);

create policy "dms_accounts_snapshot_insert_admins"
on public.dms_accounts_snapshot
for insert
to authenticated
with check (
  (
    public.has_organization_role(organization_id, array['admin'])
    or public.current_app_role() = 'dev'
  )
  and exists (
    select 1
    from public.dms_import_batches batch
    where batch.id = import_batch_id
      and batch.organization_id = dms_accounts_snapshot.organization_id
      and batch.report_type = 'all_accounts'
  )
);

create policy "dms_accounts_snapshot_update_admins"
on public.dms_accounts_snapshot
for update
to authenticated
using (
  public.has_organization_role(organization_id, array['admin'])
  or public.current_app_role() = 'dev'
)
with check (
  (
    public.has_organization_role(organization_id, array['admin'])
    or public.current_app_role() = 'dev'
  )
  and exists (
    select 1
    from public.dms_import_batches batch
    where batch.id = import_batch_id
      and batch.organization_id = dms_accounts_snapshot.organization_id
      and batch.report_type = 'all_accounts'
  )
);

create policy "dms_accounts_snapshot_delete_dev_only"
on public.dms_accounts_snapshot
for delete
to authenticated
using (public.current_app_role() = 'dev');

create policy "dms_payment_ledger_select_raw_managers"
on public.dms_payment_ledger
for select
to authenticated
using (
  public.has_organization_role(organization_id, array['management', 'admin'])
  or public.current_app_role() = 'dev'
);

create policy "dms_payment_ledger_insert_admins"
on public.dms_payment_ledger
for insert
to authenticated
with check (
  (
    public.has_organization_role(organization_id, array['admin'])
    or public.current_app_role() = 'dev'
  )
  and exists (
    select 1
    from public.dms_import_batches batch
    where batch.id = import_batch_id
      and batch.organization_id = dms_payment_ledger.organization_id
      and batch.report_type = 'payment_ledger'
  )
);

create policy "dms_payment_ledger_update_admins"
on public.dms_payment_ledger
for update
to authenticated
using (
  public.has_organization_role(organization_id, array['admin'])
  or public.current_app_role() = 'dev'
)
with check (
  (
    public.has_organization_role(organization_id, array['admin'])
    or public.current_app_role() = 'dev'
  )
  and exists (
    select 1
    from public.dms_import_batches batch
    where batch.id = import_batch_id
      and batch.organization_id = dms_payment_ledger.organization_id
      and batch.report_type = 'payment_ledger'
  )
);

create policy "dms_payment_ledger_delete_dev_only"
on public.dms_payment_ledger
for delete
to authenticated
using (public.current_app_role() = 'dev');

create policy "dms_activity_events_select_raw_managers"
on public.dms_activity_events
for select
to authenticated
using (
  public.has_organization_role(organization_id, array['management', 'admin'])
  or public.current_app_role() = 'dev'
);

create policy "dms_activity_events_insert_admins"
on public.dms_activity_events
for insert
to authenticated
with check (
  (
    public.has_organization_role(organization_id, array['admin'])
    or public.current_app_role() = 'dev'
  )
  and exists (
    select 1
    from public.dms_import_batches batch
    where batch.id = import_batch_id
      and batch.organization_id = dms_activity_events.organization_id
      and batch.report_type = 'bhph_activities'
  )
);

create policy "dms_activity_events_update_admins"
on public.dms_activity_events
for update
to authenticated
using (
  public.has_organization_role(organization_id, array['admin'])
  or public.current_app_role() = 'dev'
)
with check (
  (
    public.has_organization_role(organization_id, array['admin'])
    or public.current_app_role() = 'dev'
  )
  and exists (
    select 1
    from public.dms_import_batches batch
    where batch.id = import_batch_id
      and batch.organization_id = dms_activity_events.organization_id
      and batch.report_type = 'bhph_activities'
  )
);

create policy "dms_activity_events_delete_dev_only"
on public.dms_activity_events
for delete
to authenticated
using (public.current_app_role() = 'dev');

comment on function public.dms_parse_numeric(text)
  is 'Parses DMS money/number strings, including commas, dollar signs, percentages, blanks, and accounting negatives.';
comment on function public.dms_parse_date(text)
  is 'Parses DMS date strings in MM/DD/YYYY-style formats into date values.';
comment on function public.dms_parse_timestamptz(text)
  is 'Parses DMS timestamp strings while returning null for blank or unrecognized values.';
comment on function public.dms_parse_boolean(text)
  is 'Parses common DMS boolean values such as TRUE/FALSE, YES/NO, Y/N, and 1/0.';
comment on function public.dms_payment_frequency_days(text)
  is 'Maps DMS payment frequency labels to an approximate number of days per scheduled payment.';
comment on function public.dms_hash_part(text)
  is 'Normalizes text for deterministic DMS transaction and activity hashes.';

comment on table public.dms_import_batches
  is 'Tracks each DMS report import batch for Atlas IQ risk and feedback-loop processing.';
comment on column public.dms_import_batches.source_headers
  is 'Ordered source CSV headers captured at import time to detect DMS report schema drift.';
comment on column public.dms_import_batches.raw_metadata
  is 'Importer-supplied metadata about the source report, parser, and import context.';

comment on table public.dms_accounts_snapshot
  is 'One account-level DMS snapshot row per deal per import batch; contains PII in raw_data and is restricted by RLS.';
comment on column public.dms_accounts_snapshot.snapshot_date
  is 'Business date for the account snapshot; defaults to current_date unless import logic supplies a report date.';
comment on column public.dms_accounts_snapshot.deal_number
  is 'Exact DMS Deal Number stored as text; never cast to numeric.';
comment on column public.dms_accounts_snapshot.raw_data
  is 'Original DMS CSV row as JSONB for audit/reparse. Contains PII and must not be exposed through app-safe views.';

comment on table public.dms_payment_ledger
  is 'Transaction-level DMS payment ledger rows for payment performance and reversal metrics.';
comment on column public.dms_payment_ledger.transaction_hash
  is 'Deterministic text hash for upserting payment ledger rows when no stable DMS transaction ID exists.';
comment on column public.dms_payment_ledger.deal_number
  is 'Exact DMS Deal Identifier stored as text; never cast to numeric.';
comment on column public.dms_payment_ledger.positive_payment_amount
  is 'Positive non-reversal/non-returned payment amount that may count toward actual payment performance.';
comment on column public.dms_payment_ledger.reversal_amount
  is 'Returned, NSF, reversal, or negative amount used for reversal metrics and excluded from positive payment totals.';
comment on column public.dms_payment_ledger.raw_data
  is 'Original DMS CSV row as JSONB for audit/reparse. Contains PII and must not be exposed through app-safe views.';

comment on table public.dms_activity_events
  is 'Collections activity/event rows from DMS BHPH activity exports.';
comment on column public.dms_activity_events.event_hash
  is 'Deterministic text hash for upserting activity events when no stable DMS event ID exists.';
comment on column public.dms_activity_events.deal_number
  is 'Exact DMS Account Number stored as text; never cast to numeric.';
comment on column public.dms_activity_events.raw_data
  is 'Original DMS CSV row as JSONB for audit/reparse. Contains PII and must not be exposed through app-safe views.';

commit;
