begin;

do $$
begin
  if not exists (
    select 1
    from public.organizations
    where slug = '865-autos'
  ) then
    raise exception 'Default organization with slug 865-autos not found';
  end if;
end $$;

alter table public.trivian_inventory
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.vehicle_term_policy
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.underwriting_tier_policy
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.trivian_config
  add column if not exists organization_id uuid references public.organizations(id);

update public.trivian_inventory ti
set organization_id = (
  select id
  from public.organizations
  where slug = '865-autos'
  limit 1
)
where ti.organization_id is null;

update public.vehicle_term_policy vtp
set organization_id = (
  select id
  from public.organizations
  where slug = '865-autos'
  limit 1
)
where vtp.organization_id is null;

update public.underwriting_tier_policy utp
set organization_id = (
  select id
  from public.organizations
  where slug = '865-autos'
  limit 1
)
where utp.organization_id is null;

update public.trivian_config tc
set organization_id = (
  select id
  from public.organizations
  where slug = '865-autos'
  limit 1
)
where tc.organization_id is null;

create index if not exists trivian_inventory_organization_date_in_stock_idx
  on public.trivian_inventory (organization_id, date_in_stock asc, id);

create index if not exists trivian_inventory_organization_status_date_in_stock_idx
  on public.trivian_inventory (organization_id, status, date_in_stock asc);

create index if not exists vehicle_term_policy_organization_active_sort_idx
  on public.vehicle_term_policy (organization_id, active, sort_order);

create index if not exists underwriting_tier_policy_organization_tier_active_sort_idx
  on public.underwriting_tier_policy (organization_id, tier, active, sort_order);

create index if not exists trivian_config_organization_created_at_idx
  on public.trivian_config (organization_id, created_at desc);

alter table public.trivian_inventory enable row level security;
alter table public.vehicle_term_policy enable row level security;
alter table public.underwriting_tier_policy enable row level security;
alter table public.trivian_config enable row level security;

drop policy if exists "trivian_inventory_select_active_members" on public.trivian_inventory;
create policy "trivian_inventory_select_active_members"
on public.trivian_inventory
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "trivian_inventory_insert_active_members" on public.trivian_inventory;
create policy "trivian_inventory_insert_active_members"
on public.trivian_inventory
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "trivian_inventory_update_active_members" on public.trivian_inventory;
create policy "trivian_inventory_update_active_members"
on public.trivian_inventory
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

drop policy if exists "trivian_inventory_delete_active_members" on public.trivian_inventory;
create policy "trivian_inventory_delete_active_members"
on public.trivian_inventory
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "vehicle_term_policy_select_active_members" on public.vehicle_term_policy;
create policy "vehicle_term_policy_select_active_members"
on public.vehicle_term_policy
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "vehicle_term_policy_insert_active_members" on public.vehicle_term_policy;
create policy "vehicle_term_policy_insert_active_members"
on public.vehicle_term_policy
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "vehicle_term_policy_update_active_members" on public.vehicle_term_policy;
create policy "vehicle_term_policy_update_active_members"
on public.vehicle_term_policy
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

drop policy if exists "vehicle_term_policy_delete_active_members" on public.vehicle_term_policy;
create policy "vehicle_term_policy_delete_active_members"
on public.vehicle_term_policy
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "underwriting_tier_policy_select_active_members" on public.underwriting_tier_policy;
create policy "underwriting_tier_policy_select_active_members"
on public.underwriting_tier_policy
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "underwriting_tier_policy_insert_active_members" on public.underwriting_tier_policy;
create policy "underwriting_tier_policy_insert_active_members"
on public.underwriting_tier_policy
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "underwriting_tier_policy_update_active_members" on public.underwriting_tier_policy;
create policy "underwriting_tier_policy_update_active_members"
on public.underwriting_tier_policy
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

drop policy if exists "underwriting_tier_policy_delete_active_members" on public.underwriting_tier_policy;
create policy "underwriting_tier_policy_delete_active_members"
on public.underwriting_tier_policy
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "trivian_config_select_active_members" on public.trivian_config;
create policy "trivian_config_select_active_members"
on public.trivian_config
for select
to authenticated
using (
  organization_id is null
  or public.is_active_organization_member(organization_id)
);

drop policy if exists "trivian_config_insert_active_members" on public.trivian_config;
create policy "trivian_config_insert_active_members"
on public.trivian_config
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "trivian_config_update_active_members" on public.trivian_config;
create policy "trivian_config_update_active_members"
on public.trivian_config
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

drop policy if exists "trivian_config_delete_active_members" on public.trivian_config;
create policy "trivian_config_delete_active_members"
on public.trivian_config
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

commit;

-- Intentionally leaving organization_id nullable in this batch.
-- Reasons:
-- 1) the repo does not expose the complete production schema or every historical write path,
-- 2) trivian_config keeps a transitional app-level fallback for global rows,
-- 3) we should verify backfill results in production before tightening constraints.
--
-- Verification queries:
-- select count(*) as trivian_inventory_missing_organization_id
-- from public.trivian_inventory
-- where organization_id is null;
--
-- select organization_id, count(*) as inventory_rows
-- from public.trivian_inventory
-- group by organization_id
-- order by inventory_rows desc;
--
-- select count(*) as vehicle_term_policy_missing_organization_id
-- from public.vehicle_term_policy
-- where organization_id is null;
--
-- select organization_id, tier, count(*) as tier_rows
-- from public.underwriting_tier_policy
-- group by organization_id, tier
-- order by organization_id, tier;
--
-- select count(*) as underwriting_tier_policy_missing_organization_id
-- from public.underwriting_tier_policy
-- where organization_id is null;
--
-- select organization_id, count(*) as trivian_config_rows
-- from public.trivian_config
-- group by organization_id
-- order by organization_id nulls first;
--
-- select schemaname, tablename, policyname, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in (
--     'trivian_inventory',
--     'vehicle_term_policy',
--     'underwriting_tier_policy',
--     'trivian_config'
--   )
-- order by tablename, policyname;
