begin;

alter table public.deal_structure_inputs enable row level security;

drop policy if exists "deal_structure_inputs_select_active_members"
on public.deal_structure_inputs;

create policy "deal_structure_inputs_select_active_members"
on public.deal_structure_inputs
for select
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_structure_inputs.deal_id
      and d.organization_id = deal_structure_inputs.organization_id
  )
);

drop policy if exists "deal_structure_inputs_insert_active_members"
on public.deal_structure_inputs;

create policy "deal_structure_inputs_insert_active_members"
on public.deal_structure_inputs
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_structure_inputs.deal_id
      and d.organization_id = deal_structure_inputs.organization_id
  )
  and (
    deal_structure_inputs.vehicle_id is null
    or exists (
      select 1
      from public.trivian_inventory v
      where v.id = deal_structure_inputs.vehicle_id
        and v.organization_id = deal_structure_inputs.organization_id
    )
  )
);

drop policy if exists "deal_structure_inputs_update_active_members"
on public.deal_structure_inputs;

create policy "deal_structure_inputs_update_active_members"
on public.deal_structure_inputs
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_structure_inputs.deal_id
      and d.organization_id = deal_structure_inputs.organization_id
  )
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_structure_inputs.deal_id
      and d.organization_id = deal_structure_inputs.organization_id
  )
  and (
    deal_structure_inputs.vehicle_id is null
    or exists (
      select 1
      from public.trivian_inventory v
      where v.id = deal_structure_inputs.vehicle_id
        and v.organization_id = deal_structure_inputs.organization_id
    )
  )
);

drop policy if exists "deal_structure_inputs_delete_active_members"
on public.deal_structure_inputs;

create policy "deal_structure_inputs_delete_active_members"
on public.deal_structure_inputs
for delete
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_structure_inputs.deal_id
      and d.organization_id = deal_structure_inputs.organization_id
  )
);

commit;
