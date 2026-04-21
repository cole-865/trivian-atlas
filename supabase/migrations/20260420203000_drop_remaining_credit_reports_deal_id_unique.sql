begin;

alter table public.credit_reports
  drop constraint if exists credit_reports_deal_id_unique;

alter table public.credit_reports
  drop constraint if exists credit_reports_deal_id_key;

drop index if exists public.credit_reports_deal_id_unique;
drop index if exists public.credit_reports_deal_id_key;

create unique index if not exists credit_reports_organization_deal_role_uidx
  on public.credit_reports (organization_id, deal_id, applicant_role);

commit;
