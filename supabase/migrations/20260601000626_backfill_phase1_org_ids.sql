begin;

-- Backfill legacy rows before relying on Phase 1 org-scoped RLS policies.
-- These updates only derive organization_id from already-linked parent rows.

update public.deal_people person
set organization_id = deal.organization_id
from public.deals deal
where deal.id = person.deal_id
  and person.organization_id is null
  and deal.organization_id is not null;

update public.income_profiles income
set organization_id = person.organization_id
from public.deal_people person
where person.id = income.deal_person_id
  and income.organization_id is null
  and person.organization_id is not null;

commit;
