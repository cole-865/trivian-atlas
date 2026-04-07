begin;

alter table public.deals
  add column if not exists organization_id uuid references public.organizations(id);

do $$
declare
  v_default_organization_id uuid;
begin
  select o.id
  into v_default_organization_id
  from public.organizations o
  where o.slug = '865-autos'
  limit 1;

  if v_default_organization_id is null then
    raise exception 'Default organization with slug % was not found', '865-autos';
  end if;

  update public.deals
  set
    organization_id = v_default_organization_id,
    updated_at = timezone('utc', now())
  where organization_id is null;
end
$$;

create index if not exists deals_organization_id_idx
  on public.deals (organization_id);

create index if not exists deals_organization_updated_at_idx
  on public.deals (organization_id, updated_at desc);

alter table public.deals enable row level security;

drop policy if exists "deals_select_active_members" on public.deals;
create policy "deals_select_active_members"
on public.deals
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "deals_insert_active_members" on public.deals;
create policy "deals_insert_active_members"
on public.deals
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "deals_update_active_members" on public.deals;
create policy "deals_update_active_members"
on public.deals
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "deals_delete_active_members" on public.deals;
create policy "deals_delete_active_members"
on public.deals
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

create or replace function public.create_deal_with_seed_data(
  p_customer_name text,
  p_organization_id uuid
)
returns table (
  deal_id uuid,
  approval_number text
)
language plpgsql
security definer
set search_path = public
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
  end if;

  return query
  select v_created.deal_id::uuid, v_created.approval_number::text;
end;
$$;

grant execute on function public.create_deal_with_seed_data(text, uuid) to authenticated;

commit;

-- Verification queries:
-- select count(*) as deals_missing_organization_id
-- from public.deals
-- where organization_id is null;
--
-- select o.slug, count(*) as deal_count
-- from public.deals d
-- join public.organizations o on o.id = d.organization_id
-- group by o.slug
-- order by o.slug;
--
-- select policyname, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'deals'
-- order by policyname;
