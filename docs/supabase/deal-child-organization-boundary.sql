begin;

alter table public.deal_people
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.income_profiles
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.deal_documents
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.deal_structure
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.deal_vehicle_selection
  add column if not exists organization_id uuid references public.organizations(id);

update public.deal_people dp
set organization_id = d.organization_id
from public.deals d
where d.id = dp.deal_id
  and dp.organization_id is null
  and d.organization_id is not null;

update public.income_profiles ip
set organization_id = d.organization_id
from public.deal_people dp
join public.deals d
  on d.id = dp.deal_id
where dp.id = ip.deal_person_id
  and ip.organization_id is null
  and d.organization_id is not null;

update public.deal_documents dd
set organization_id = d.organization_id
from public.deals d
where d.id = dd.deal_id
  and dd.organization_id is null
  and d.organization_id is not null;

update public.deal_structure ds
set organization_id = d.organization_id
from public.deals d
where d.id = ds.deal_id
  and ds.organization_id is null
  and d.organization_id is not null;

update public.deal_vehicle_selection dvs
set organization_id = d.organization_id
from public.deals d
where d.id = dvs.deal_id
  and dvs.organization_id is null
  and d.organization_id is not null;

create index if not exists deal_people_organization_deal_role_idx
  on public.deal_people (organization_id, deal_id, role);

create index if not exists deal_people_organization_deal_created_at_idx
  on public.deal_people (organization_id, deal_id, created_at);

create index if not exists income_profiles_organization_deal_person_created_at_idx
  on public.income_profiles (organization_id, deal_person_id, created_at);

create index if not exists deal_documents_organization_deal_created_at_idx
  on public.deal_documents (organization_id, deal_id, created_at desc);

create index if not exists deal_structure_organization_deal_idx
  on public.deal_structure (organization_id, deal_id);

create index if not exists deal_vehicle_selection_organization_deal_idx
  on public.deal_vehicle_selection (organization_id, deal_id);

alter table public.deal_people enable row level security;
alter table public.income_profiles enable row level security;
alter table public.deal_documents enable row level security;
alter table public.deal_structure enable row level security;
alter table public.deal_vehicle_selection enable row level security;

drop policy if exists "deal_people_select_active_members" on public.deal_people;
create policy "deal_people_select_active_members"
on public.deal_people
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "deal_people_insert_active_members" on public.deal_people;
create policy "deal_people_insert_active_members"
on public.deal_people
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = deal_people.organization_id
  )
);

drop policy if exists "deal_people_update_active_members" on public.deal_people;
create policy "deal_people_update_active_members"
on public.deal_people
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
      and d.organization_id = deal_people.organization_id
  )
);

drop policy if exists "deal_people_delete_active_members" on public.deal_people;
create policy "deal_people_delete_active_members"
on public.deal_people
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "income_profiles_select_active_members" on public.income_profiles;
create policy "income_profiles_select_active_members"
on public.income_profiles
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "income_profiles_insert_active_members" on public.income_profiles;
create policy "income_profiles_insert_active_members"
on public.income_profiles
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deal_people dp
    join public.deals d
      on d.id = dp.deal_id
    where dp.id = deal_person_id
      and d.organization_id = income_profiles.organization_id
  )
);

drop policy if exists "income_profiles_update_active_members" on public.income_profiles;
create policy "income_profiles_update_active_members"
on public.income_profiles
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
    from public.deal_people dp
    join public.deals d
      on d.id = dp.deal_id
    where dp.id = deal_person_id
      and d.organization_id = income_profiles.organization_id
  )
);

drop policy if exists "income_profiles_delete_active_members" on public.income_profiles;
create policy "income_profiles_delete_active_members"
on public.income_profiles
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "deal_documents_select_active_members" on public.deal_documents;
create policy "deal_documents_select_active_members"
on public.deal_documents
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "deal_documents_insert_active_members" on public.deal_documents;
create policy "deal_documents_insert_active_members"
on public.deal_documents
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = deal_documents.organization_id
  )
);

drop policy if exists "deal_documents_update_active_members" on public.deal_documents;
create policy "deal_documents_update_active_members"
on public.deal_documents
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
      and d.organization_id = deal_documents.organization_id
  )
);

drop policy if exists "deal_documents_delete_active_members" on public.deal_documents;
create policy "deal_documents_delete_active_members"
on public.deal_documents
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "deal_structure_select_active_members" on public.deal_structure;
create policy "deal_structure_select_active_members"
on public.deal_structure
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "deal_structure_insert_active_members" on public.deal_structure;
create policy "deal_structure_insert_active_members"
on public.deal_structure
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = deal_structure.organization_id
  )
);

drop policy if exists "deal_structure_update_active_members" on public.deal_structure;
create policy "deal_structure_update_active_members"
on public.deal_structure
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
      and d.organization_id = deal_structure.organization_id
  )
);

drop policy if exists "deal_structure_delete_active_members" on public.deal_structure;
create policy "deal_structure_delete_active_members"
on public.deal_structure
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "deal_vehicle_selection_select_active_members" on public.deal_vehicle_selection;
create policy "deal_vehicle_selection_select_active_members"
on public.deal_vehicle_selection
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

drop policy if exists "deal_vehicle_selection_insert_active_members" on public.deal_vehicle_selection;
create policy "deal_vehicle_selection_insert_active_members"
on public.deal_vehicle_selection
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = deal_vehicle_selection.organization_id
  )
);

drop policy if exists "deal_vehicle_selection_update_active_members" on public.deal_vehicle_selection;
create policy "deal_vehicle_selection_update_active_members"
on public.deal_vehicle_selection
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
      and d.organization_id = deal_vehicle_selection.organization_id
  )
);

drop policy if exists "deal_vehicle_selection_delete_active_members" on public.deal_vehicle_selection;
create policy "deal_vehicle_selection_delete_active_members"
on public.deal_vehicle_selection
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
);

commit;

-- Intentionally leaving organization_id nullable in this batch.
-- Tighten to not null only after production verification confirms:
-- 1) backfill leaves zero null rows,
-- 2) there are no hidden write paths still omitting organization_id,
-- 3) there are no historical orphan rows that need manual cleanup.

-- Verification queries:
-- select count(*) as deal_people_missing_organization_id
-- from public.deal_people
-- where organization_id is null;
--
-- select count(*) as deal_people_mismatched_organization_id
-- from public.deal_people dp
-- join public.deals d on d.id = dp.deal_id
-- where dp.organization_id is distinct from d.organization_id;
--
-- select count(*) as income_profiles_missing_organization_id
-- from public.income_profiles
-- where organization_id is null;
--
-- select count(*) as income_profiles_mismatched_organization_id
-- from public.income_profiles ip
-- join public.deal_people dp on dp.id = ip.deal_person_id
-- join public.deals d on d.id = dp.deal_id
-- where ip.organization_id is distinct from d.organization_id;
--
-- select count(*) as deal_documents_missing_organization_id
-- from public.deal_documents
-- where organization_id is null;
--
-- select count(*) as deal_documents_mismatched_organization_id
-- from public.deal_documents dd
-- join public.deals d on d.id = dd.deal_id
-- where dd.organization_id is distinct from d.organization_id;
--
-- select count(*) as deal_structure_missing_organization_id
-- from public.deal_structure
-- where organization_id is null;
--
-- select count(*) as deal_structure_mismatched_organization_id
-- from public.deal_structure ds
-- join public.deals d on d.id = ds.deal_id
-- where ds.organization_id is distinct from d.organization_id;
--
-- select count(*) as deal_vehicle_selection_missing_organization_id
-- from public.deal_vehicle_selection
-- where organization_id is null;
--
-- select count(*) as deal_vehicle_selection_mismatched_organization_id
-- from public.deal_vehicle_selection dvs
-- join public.deals d on d.id = dvs.deal_id
-- where dvs.organization_id is distinct from d.organization_id;
--
-- select schemaname, tablename, policyname, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in (
--     'deal_people',
--     'income_profiles',
--     'deal_documents',
--     'deal_structure',
--     'deal_vehicle_selection'
--   )
-- order by tablename, policyname;
