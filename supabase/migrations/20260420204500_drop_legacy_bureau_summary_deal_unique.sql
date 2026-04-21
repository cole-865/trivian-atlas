begin;

alter table public.bureau_summary
  drop constraint if exists bureau_summary_deal_uq;

alter table public.bureau_summary
  drop constraint if exists bureau_summary_deal_id_key;

drop index if exists public.bureau_summary_deal_uq;
drop index if exists public.bureau_summary_deal_id_key;

create index if not exists bureau_summary_organization_deal_role_created_at_idx
  on public.bureau_summary (organization_id, deal_id, applicant_role, created_at desc);

commit;
