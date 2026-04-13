begin;

alter table public.deal_funding_stip_verifications
  add column if not exists verified_monthly_income numeric null;

commit;
