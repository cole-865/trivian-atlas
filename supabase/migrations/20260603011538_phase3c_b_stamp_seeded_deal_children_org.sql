begin;

create or replace function public.create_deal_with_seed_data(
  p_customer_name text,
  p_organization_id uuid
)
returns table(deal_id uuid, approval_number text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_created record;
begin
  select *
  into v_created
  from public.create_deal_with_seed_data(p_customer_name)
  limit 1;

  if v_created.deal_id is null then
    return;
  end if;

  if p_organization_id is not null then
    if not public.is_active_organization_member(p_organization_id) then
      raise exception 'User is not an active member of organization %', p_organization_id;
    end if;

    update public.deals
    set
      organization_id = p_organization_id,
      updated_at = timezone('utc', now())
    where id = v_created.deal_id;

    update public.deal_people
    set organization_id = p_organization_id
    where deal_id = v_created.deal_id
      and organization_id is null;

    update public.income_profiles income
    set organization_id = p_organization_id
    from public.deal_people person
    where person.id = income.deal_person_id
      and person.deal_id = v_created.deal_id
      and income.organization_id is null;
  end if;

  return query
  select v_created.deal_id::uuid, v_created.approval_number::text;
end;
$$;

update public.deal_people person
set organization_id = deal.organization_id
from public.deals deal
where deal.id = person.deal_id
  and deal.organization_id is not null
  and person.organization_id is null;

update public.income_profiles income
set organization_id = person.organization_id
from public.deal_people person
where person.id = income.deal_person_id
  and person.organization_id is not null
  and income.organization_id is null;

commit;
