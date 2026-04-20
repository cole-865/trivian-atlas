begin;

alter table public.deal_documents
  add column if not exists applicant_role text null;

alter table public.credit_report_jobs
  add column if not exists applicant_role text not null default 'primary';

alter table public.credit_reports
  add column if not exists applicant_role text not null default 'primary';

alter table public.bureau_summary
  add column if not exists applicant_role text not null default 'primary';

alter table public.bureau_tradelines
  add column if not exists applicant_role text not null default 'primary';

alter table public.bureau_public_records
  add column if not exists applicant_role text not null default 'primary';

alter table public.bureau_messages
  add column if not exists applicant_role text not null default 'primary';

update public.deal_documents
set applicant_role = 'primary'
where doc_type = 'credit_bureau'
  and applicant_role is null;

update public.credit_report_jobs
set applicant_role = 'primary'
where applicant_role is null;

update public.credit_reports
set applicant_role = 'primary'
where applicant_role is null;

update public.bureau_summary
set applicant_role = 'primary'
where applicant_role is null;

update public.bureau_tradelines
set applicant_role = 'primary'
where applicant_role is null;

update public.bureau_public_records
set applicant_role = 'primary'
where applicant_role is null;

update public.bureau_messages
set applicant_role = 'primary'
where applicant_role is null;

alter table public.deal_documents
  drop constraint if exists deal_documents_applicant_role_check;

alter table public.deal_documents
  add constraint deal_documents_applicant_role_check
  check (
    applicant_role is null
    or applicant_role in ('primary', 'co')
  );

alter table public.credit_report_jobs
  drop constraint if exists credit_report_jobs_applicant_role_check;

alter table public.credit_report_jobs
  add constraint credit_report_jobs_applicant_role_check
  check (applicant_role in ('primary', 'co'));

alter table public.credit_reports
  drop constraint if exists credit_reports_applicant_role_check;

alter table public.credit_reports
  add constraint credit_reports_applicant_role_check
  check (applicant_role in ('primary', 'co'));

alter table public.bureau_summary
  drop constraint if exists bureau_summary_applicant_role_check;

alter table public.bureau_summary
  add constraint bureau_summary_applicant_role_check
  check (applicant_role in ('primary', 'co'));

alter table public.bureau_tradelines
  drop constraint if exists bureau_tradelines_applicant_role_check;

alter table public.bureau_tradelines
  add constraint bureau_tradelines_applicant_role_check
  check (applicant_role in ('primary', 'co'));

alter table public.bureau_public_records
  drop constraint if exists bureau_public_records_applicant_role_check;

alter table public.bureau_public_records
  add constraint bureau_public_records_applicant_role_check
  check (applicant_role in ('primary', 'co'));

alter table public.bureau_messages
  drop constraint if exists bureau_messages_applicant_role_check;

alter table public.bureau_messages
  add constraint bureau_messages_applicant_role_check
  check (applicant_role in ('primary', 'co'));

drop index if exists credit_reports_organization_deal_idx;
create unique index if not exists credit_reports_organization_deal_role_uidx
  on public.credit_reports (organization_id, deal_id, applicant_role);

create index if not exists credit_report_jobs_organization_deal_role_created_at_idx
  on public.credit_report_jobs (organization_id, deal_id, applicant_role, created_at desc);

create index if not exists bureau_summary_organization_deal_role_created_at_idx
  on public.bureau_summary (organization_id, deal_id, applicant_role, created_at desc);

create index if not exists bureau_tradelines_organization_deal_role_created_at_idx
  on public.bureau_tradelines (organization_id, deal_id, applicant_role, created_at);

create index if not exists bureau_public_records_organization_deal_role_created_at_idx
  on public.bureau_public_records (organization_id, deal_id, applicant_role, created_at);

create index if not exists bureau_messages_organization_deal_role_created_at_idx
  on public.bureau_messages (organization_id, deal_id, applicant_role, created_at);

create index if not exists deal_documents_organization_deal_doc_role_created_at_idx
  on public.deal_documents (organization_id, deal_id, doc_type, applicant_role, created_at desc);

commit;
