begin;

alter table public.underwriting_inputs
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.underwriting_results
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.credit_report_jobs
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.credit_reports
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.bureau_summary
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.bureau_tradelines
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.bureau_messages
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.bureau_public_records
  add column if not exists organization_id uuid references public.organizations(id);

update public.underwriting_inputs ui
set organization_id = d.organization_id
from public.deals d
where d.id = ui.deal_id
  and ui.organization_id is null
  and d.organization_id is not null;

update public.underwriting_results ur
set organization_id = d.organization_id
from public.deals d
where d.id = ur.deal_id
  and ur.organization_id is null
  and d.organization_id is not null;

update public.credit_report_jobs crj
set organization_id = d.organization_id
from public.deals d
where d.id = crj.deal_id
  and crj.organization_id is null
  and d.organization_id is not null;

update public.credit_reports cr
set organization_id = d.organization_id
from public.deals d
where d.id = cr.deal_id
  and cr.organization_id is null
  and d.organization_id is not null;

update public.bureau_summary bs
set organization_id = cr.organization_id
from public.credit_reports cr
where cr.id = bs.credit_report_id
  and bs.organization_id is null
  and cr.organization_id is not null;

update public.bureau_summary bs
set organization_id = d.organization_id
from public.deals d
where d.id = bs.deal_id
  and bs.organization_id is null
  and d.organization_id is not null;

update public.bureau_tradelines bt
set organization_id = bs.organization_id
from public.bureau_summary bs
where bs.id = bt.bureau_summary_id
  and bt.organization_id is null
  and bs.organization_id is not null;

update public.bureau_tradelines bt
set organization_id = d.organization_id
from public.deals d
where d.id = bt.deal_id
  and bt.organization_id is null
  and d.organization_id is not null;

update public.bureau_messages bm
set organization_id = bs.organization_id
from public.bureau_summary bs
where bs.id = bm.bureau_summary_id
  and bm.organization_id is null
  and bs.organization_id is not null;

update public.bureau_messages bm
set organization_id = d.organization_id
from public.deals d
where d.id = bm.deal_id
  and bm.organization_id is null
  and d.organization_id is not null;

update public.bureau_public_records bpr
set organization_id = bs.organization_id
from public.bureau_summary bs
where bs.id = bpr.bureau_summary_id
  and bpr.organization_id is null
  and bs.organization_id is not null;

update public.bureau_public_records bpr
set organization_id = d.organization_id
from public.deals d
where d.id = bpr.deal_id
  and bpr.organization_id is null
  and d.organization_id is not null;

create index if not exists underwriting_inputs_organization_deal_idx
  on public.underwriting_inputs (organization_id, deal_id);

create index if not exists underwriting_results_organization_deal_stage_idx
  on public.underwriting_results (organization_id, deal_id, stage);

create index if not exists credit_report_jobs_organization_deal_created_at_idx
  on public.credit_report_jobs (organization_id, deal_id, created_at desc);

create index if not exists credit_report_jobs_organization_status_created_at_idx
  on public.credit_report_jobs (organization_id, status, created_at desc);

create index if not exists credit_reports_organization_deal_idx
  on public.credit_reports (organization_id, deal_id);

create index if not exists credit_reports_organization_latest_job_idx
  on public.credit_reports (organization_id, latest_job_id);

create index if not exists bureau_summary_organization_deal_created_at_idx
  on public.bureau_summary (organization_id, deal_id, created_at desc);

create index if not exists bureau_summary_organization_credit_report_idx
  on public.bureau_summary (organization_id, credit_report_id);

create index if not exists bureau_tradelines_organization_deal_created_at_idx
  on public.bureau_tradelines (organization_id, deal_id, created_at);

create index if not exists bureau_tradelines_organization_summary_idx
  on public.bureau_tradelines (organization_id, bureau_summary_id);

create index if not exists bureau_messages_organization_deal_created_at_idx
  on public.bureau_messages (organization_id, deal_id, created_at);

create index if not exists bureau_messages_organization_summary_idx
  on public.bureau_messages (organization_id, bureau_summary_id);

create index if not exists bureau_public_records_organization_deal_created_at_idx
  on public.bureau_public_records (organization_id, deal_id, created_at);

create index if not exists bureau_public_records_organization_summary_idx
  on public.bureau_public_records (organization_id, bureau_summary_id);

alter table public.underwriting_inputs enable row level security;
alter table public.underwriting_results enable row level security;
alter table public.credit_report_jobs enable row level security;
alter table public.credit_reports enable row level security;
alter table public.bureau_summary enable row level security;
alter table public.bureau_tradelines enable row level security;
alter table public.bureau_messages enable row level security;
alter table public.bureau_public_records enable row level security;

drop policy if exists "underwriting_inputs_select_active_members" on public.underwriting_inputs;
create policy "underwriting_inputs_select_active_members"
on public.underwriting_inputs
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "underwriting_inputs_insert_active_members" on public.underwriting_inputs;
create policy "underwriting_inputs_insert_active_members"
on public.underwriting_inputs
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = underwriting_inputs.organization_id
  )
);

drop policy if exists "underwriting_inputs_update_active_members" on public.underwriting_inputs;
create policy "underwriting_inputs_update_active_members"
on public.underwriting_inputs
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = underwriting_inputs.organization_id
  )
);

drop policy if exists "underwriting_inputs_delete_active_members" on public.underwriting_inputs;
create policy "underwriting_inputs_delete_active_members"
on public.underwriting_inputs
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "underwriting_results_select_active_members" on public.underwriting_results;
create policy "underwriting_results_select_active_members"
on public.underwriting_results
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "underwriting_results_insert_active_members" on public.underwriting_results;
create policy "underwriting_results_insert_active_members"
on public.underwriting_results
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = underwriting_results.organization_id
  )
);

drop policy if exists "underwriting_results_update_active_members" on public.underwriting_results;
create policy "underwriting_results_update_active_members"
on public.underwriting_results
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = underwriting_results.organization_id
  )
);

drop policy if exists "underwriting_results_delete_active_members" on public.underwriting_results;
create policy "underwriting_results_delete_active_members"
on public.underwriting_results
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "credit_report_jobs_select_active_members" on public.credit_report_jobs;
create policy "credit_report_jobs_select_active_members"
on public.credit_report_jobs
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "credit_report_jobs_insert_active_members" on public.credit_report_jobs;
create policy "credit_report_jobs_insert_active_members"
on public.credit_report_jobs
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = credit_report_jobs.organization_id
  )
);

drop policy if exists "credit_report_jobs_update_active_members" on public.credit_report_jobs;
create policy "credit_report_jobs_update_active_members"
on public.credit_report_jobs
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = credit_report_jobs.organization_id
  )
);

drop policy if exists "credit_report_jobs_delete_active_members" on public.credit_report_jobs;
create policy "credit_report_jobs_delete_active_members"
on public.credit_report_jobs
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "credit_reports_select_active_members" on public.credit_reports;
create policy "credit_reports_select_active_members"
on public.credit_reports
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "credit_reports_insert_active_members" on public.credit_reports;
create policy "credit_reports_insert_active_members"
on public.credit_reports
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = credit_reports.organization_id
  )
  and (
    latest_job_id is null
    or exists (
      select 1
      from public.credit_report_jobs crj
      where crj.id = latest_job_id
        and crj.deal_id = credit_reports.deal_id
        and crj.organization_id = credit_reports.organization_id
    )
  )
);

drop policy if exists "credit_reports_update_active_members" on public.credit_reports;
create policy "credit_reports_update_active_members"
on public.credit_reports
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = credit_reports.organization_id
  )
  and (
    latest_job_id is null
    or exists (
      select 1
      from public.credit_report_jobs crj
      where crj.id = latest_job_id
        and crj.deal_id = credit_reports.deal_id
        and crj.organization_id = credit_reports.organization_id
    )
  )
);

drop policy if exists "credit_reports_delete_active_members" on public.credit_reports;
create policy "credit_reports_delete_active_members"
on public.credit_reports
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "bureau_summary_select_active_members" on public.bureau_summary;
create policy "bureau_summary_select_active_members"
on public.bureau_summary
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "bureau_summary_insert_active_members" on public.bureau_summary;
create policy "bureau_summary_insert_active_members"
on public.bureau_summary
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.credit_reports cr
    where cr.id = credit_report_id
      and cr.deal_id = bureau_summary.deal_id
      and cr.organization_id = bureau_summary.organization_id
  )
  and (
    job_id is null
    or exists (
      select 1
      from public.credit_report_jobs crj
      where crj.id = job_id
        and crj.deal_id = bureau_summary.deal_id
        and crj.organization_id = bureau_summary.organization_id
    )
  )
);

drop policy if exists "bureau_summary_update_active_members" on public.bureau_summary;
create policy "bureau_summary_update_active_members"
on public.bureau_summary
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.credit_reports cr
    where cr.id = credit_report_id
      and cr.deal_id = bureau_summary.deal_id
      and cr.organization_id = bureau_summary.organization_id
  )
  and (
    job_id is null
    or exists (
      select 1
      from public.credit_report_jobs crj
      where crj.id = job_id
        and crj.deal_id = bureau_summary.deal_id
        and crj.organization_id = bureau_summary.organization_id
    )
  )
);

drop policy if exists "bureau_summary_delete_active_members" on public.bureau_summary;
create policy "bureau_summary_delete_active_members"
on public.bureau_summary
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "bureau_tradelines_select_active_members" on public.bureau_tradelines;
create policy "bureau_tradelines_select_active_members"
on public.bureau_tradelines
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "bureau_tradelines_insert_active_members" on public.bureau_tradelines;
create policy "bureau_tradelines_insert_active_members"
on public.bureau_tradelines
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.bureau_summary bs
    where bs.id = bureau_summary_id
      and bs.deal_id = bureau_tradelines.deal_id
      and bs.organization_id = bureau_tradelines.organization_id
  )
);

drop policy if exists "bureau_tradelines_update_active_members" on public.bureau_tradelines;
create policy "bureau_tradelines_update_active_members"
on public.bureau_tradelines
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.bureau_summary bs
    where bs.id = bureau_summary_id
      and bs.deal_id = bureau_tradelines.deal_id
      and bs.organization_id = bureau_tradelines.organization_id
  )
);

drop policy if exists "bureau_tradelines_delete_active_members" on public.bureau_tradelines;
create policy "bureau_tradelines_delete_active_members"
on public.bureau_tradelines
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "bureau_messages_select_active_members" on public.bureau_messages;
create policy "bureau_messages_select_active_members"
on public.bureau_messages
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "bureau_messages_insert_active_members" on public.bureau_messages;
create policy "bureau_messages_insert_active_members"
on public.bureau_messages
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.bureau_summary bs
    where bs.id = bureau_summary_id
      and bs.deal_id = bureau_messages.deal_id
      and bs.organization_id = bureau_messages.organization_id
  )
);

drop policy if exists "bureau_messages_update_active_members" on public.bureau_messages;
create policy "bureau_messages_update_active_members"
on public.bureau_messages
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.bureau_summary bs
    where bs.id = bureau_summary_id
      and bs.deal_id = bureau_messages.deal_id
      and bs.organization_id = bureau_messages.organization_id
  )
);

drop policy if exists "bureau_messages_delete_active_members" on public.bureau_messages;
create policy "bureau_messages_delete_active_members"
on public.bureau_messages
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "bureau_public_records_select_active_members" on public.bureau_public_records;
create policy "bureau_public_records_select_active_members"
on public.bureau_public_records
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "bureau_public_records_insert_active_members" on public.bureau_public_records;
create policy "bureau_public_records_insert_active_members"
on public.bureau_public_records
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.bureau_summary bs
    where bs.id = bureau_summary_id
      and bs.deal_id = bureau_public_records.deal_id
      and bs.organization_id = bureau_public_records.organization_id
  )
);

drop policy if exists "bureau_public_records_update_active_members" on public.bureau_public_records;
create policy "bureau_public_records_update_active_members"
on public.bureau_public_records
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.bureau_summary bs
    where bs.id = bureau_summary_id
      and bs.deal_id = bureau_public_records.deal_id
      and bs.organization_id = bureau_public_records.organization_id
  )
);

drop policy if exists "bureau_public_records_delete_active_members" on public.bureau_public_records;
create policy "bureau_public_records_delete_active_members"
on public.bureau_public_records
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

commit;

-- Intentionally leaving organization_id nullable in this batch.
-- Tighten to not null only after production verification confirms:
-- 1) all backfills leave zero null rows,
-- 2) there are no hidden app or worker write paths still omitting organization_id,
-- 3) there are no historical orphan rows that need manual cleanup.
--
-- Verification queries:
-- select count(*) as underwriting_inputs_missing_organization_id
-- from public.underwriting_inputs
-- where organization_id is null;
--
-- select count(*) as underwriting_inputs_mismatched_organization_id
-- from public.underwriting_inputs ui
-- join public.deals d on d.id = ui.deal_id
-- where ui.organization_id is distinct from d.organization_id;
--
-- select count(*) as underwriting_results_missing_organization_id
-- from public.underwriting_results
-- where organization_id is null;
--
-- select count(*) as underwriting_results_mismatched_organization_id
-- from public.underwriting_results ur
-- join public.deals d on d.id = ur.deal_id
-- where ur.organization_id is distinct from d.organization_id;
--
-- select count(*) as credit_report_jobs_missing_organization_id
-- from public.credit_report_jobs
-- where organization_id is null;
--
-- select count(*) as credit_report_jobs_mismatched_organization_id
-- from public.credit_report_jobs crj
-- join public.deals d on d.id = crj.deal_id
-- where crj.organization_id is distinct from d.organization_id;
--
-- select count(*) as credit_reports_missing_organization_id
-- from public.credit_reports
-- where organization_id is null;
--
-- select count(*) as credit_reports_mismatched_organization_id
-- from public.credit_reports cr
-- join public.deals d on d.id = cr.deal_id
-- where cr.organization_id is distinct from d.organization_id;
--
-- select count(*) as bureau_summary_missing_organization_id
-- from public.bureau_summary
-- where organization_id is null;
--
-- select count(*) as bureau_summary_credit_report_mismatched_organization_id
-- from public.bureau_summary bs
-- join public.credit_reports cr on cr.id = bs.credit_report_id
-- where bs.organization_id is distinct from cr.organization_id;
--
-- select count(*) as bureau_tradelines_missing_organization_id
-- from public.bureau_tradelines
-- where organization_id is null;
--
-- select count(*) as bureau_tradelines_mismatched_organization_id
-- from public.bureau_tradelines bt
-- join public.bureau_summary bs on bs.id = bt.bureau_summary_id
-- where bt.organization_id is distinct from bs.organization_id;
--
-- select count(*) as bureau_messages_missing_organization_id
-- from public.bureau_messages
-- where organization_id is null;
--
-- select count(*) as bureau_messages_mismatched_organization_id
-- from public.bureau_messages bm
-- join public.bureau_summary bs on bs.id = bm.bureau_summary_id
-- where bm.organization_id is distinct from bs.organization_id;
--
-- select count(*) as bureau_public_records_missing_organization_id
-- from public.bureau_public_records
-- where organization_id is null;
--
-- select count(*) as bureau_public_records_mismatched_organization_id
-- from public.bureau_public_records bpr
-- join public.bureau_summary bs on bs.id = bpr.bureau_summary_id
-- where bpr.organization_id is distinct from bs.organization_id;
--
-- select schemaname, tablename, policyname, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in (
--     'underwriting_inputs',
--     'underwriting_results',
--     'credit_report_jobs',
--     'credit_reports',
--     'bureau_summary',
--     'bureau_tradelines',
--     'bureau_messages',
--     'bureau_public_records'
--   )
-- order by tablename, policyname;
