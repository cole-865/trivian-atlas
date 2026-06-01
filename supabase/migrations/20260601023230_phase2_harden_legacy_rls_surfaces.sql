begin;

-- Phase 2 narrow legacy-surface hardening:
-- - close RLS-disabled legacy tables that are still present in the schema
-- - replace broad authenticated true policies on deprecated deal-child tables
-- - keep current active global/user-scoped surfaces untouched
-- This migration does not drop tables, functions, data, or business logic.

alter table public.deal_management_notes enable row level security;

drop policy if exists "deal_management_notes_select_active_members"
on public.deal_management_notes;

create policy "deal_management_notes_select_active_members"
on public.deal_management_notes
for select
to authenticated
using (
  exists (
    select 1
    from public.deals d
    where d.id = deal_management_notes.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

drop policy if exists "deal_management_notes_insert_active_members"
on public.deal_management_notes;

create policy "deal_management_notes_insert_active_members"
on public.deal_management_notes
for insert
to authenticated
with check (
  (created_by is null or created_by = auth.uid())
  and exists (
    select 1
    from public.deals d
    where d.id = deal_management_notes.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

drop policy if exists "deal_management_notes_update_active_members"
on public.deal_management_notes;

create policy "deal_management_notes_update_active_members"
on public.deal_management_notes
for update
to authenticated
using (
  exists (
    select 1
    from public.deals d
    where d.id = deal_management_notes.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
)
with check (
  (created_by is null or created_by = auth.uid())
  and exists (
    select 1
    from public.deals d
    where d.id = deal_management_notes.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

drop policy if exists "deal_management_notes_delete_active_members"
on public.deal_management_notes;

create policy "deal_management_notes_delete_active_members"
on public.deal_management_notes
for delete
to authenticated
using (
  exists (
    select 1
    from public.deals d
    where d.id = deal_management_notes.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

alter table public.bhph_bureau_rules enable row level security;

drop policy if exists "bhph_bureau_rules_select_platform_dev"
on public.bhph_bureau_rules;

create policy "bhph_bureau_rules_select_platform_dev"
on public.bhph_bureau_rules
for select
to authenticated
using (
  (select public.current_app_role()) = 'dev'
);

drop policy if exists "bhph_bureau_rules_insert_platform_dev"
on public.bhph_bureau_rules;

create policy "bhph_bureau_rules_insert_platform_dev"
on public.bhph_bureau_rules
for insert
to authenticated
with check (
  (select public.current_app_role()) = 'dev'
);

drop policy if exists "bhph_bureau_rules_update_platform_dev"
on public.bhph_bureau_rules;

create policy "bhph_bureau_rules_update_platform_dev"
on public.bhph_bureau_rules
for update
to authenticated
using (
  (select public.current_app_role()) = 'dev'
)
with check (
  (select public.current_app_role()) = 'dev'
);

drop policy if exists "bhph_bureau_rules_delete_platform_dev"
on public.bhph_bureau_rules;

create policy "bhph_bureau_rules_delete_platform_dev"
on public.bhph_bureau_rules
for delete
to authenticated
using (
  (select public.current_app_role()) = 'dev'
);

drop policy if exists "documents_all_authenticated"
on public.documents;

drop policy if exists "documents_select_active_deal_members"
on public.documents;

create policy "documents_select_active_deal_members"
on public.documents
for select
to authenticated
using (
  exists (
    select 1
    from public.deals d
    where d.id = documents.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

drop policy if exists "documents_insert_active_deal_members"
on public.documents;

create policy "documents_insert_active_deal_members"
on public.documents
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.deals d
    where d.id = documents.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

drop policy if exists "documents_update_active_deal_members"
on public.documents;

create policy "documents_update_active_deal_members"
on public.documents
for update
to authenticated
using (
  exists (
    select 1
    from public.deals d
    where d.id = documents.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.deals d
    where d.id = documents.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

drop policy if exists "documents_delete_active_deal_members"
on public.documents;

create policy "documents_delete_active_deal_members"
on public.documents
for delete
to authenticated
using (
  exists (
    select 1
    from public.deals d
    where d.id = documents.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

drop policy if exists "vehicle_options_all_authenticated"
on public.vehicle_options;

drop policy if exists "vehicle_options_select_active_deal_members"
on public.vehicle_options;

create policy "vehicle_options_select_active_deal_members"
on public.vehicle_options
for select
to authenticated
using (
  exists (
    select 1
    from public.deals d
    where d.id = vehicle_options.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

drop policy if exists "vehicle_options_insert_active_deal_members"
on public.vehicle_options;

create policy "vehicle_options_insert_active_deal_members"
on public.vehicle_options
for insert
to authenticated
with check (
  exists (
    select 1
    from public.deals d
    where d.id = vehicle_options.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

drop policy if exists "vehicle_options_update_active_deal_members"
on public.vehicle_options;

create policy "vehicle_options_update_active_deal_members"
on public.vehicle_options
for update
to authenticated
using (
  exists (
    select 1
    from public.deals d
    where d.id = vehicle_options.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.deals d
    where d.id = vehicle_options.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

drop policy if exists "vehicle_options_delete_active_deal_members"
on public.vehicle_options;

create policy "vehicle_options_delete_active_deal_members"
on public.vehicle_options
for delete
to authenticated
using (
  exists (
    select 1
    from public.deals d
    where d.id = vehicle_options.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

drop policy if exists "vehicle_selection_all_authenticated"
on public.vehicle_selection;

drop policy if exists "vehicle_selection_select_active_deal_members"
on public.vehicle_selection;

create policy "vehicle_selection_select_active_deal_members"
on public.vehicle_selection
for select
to authenticated
using (
  exists (
    select 1
    from public.deals d
    where d.id = vehicle_selection.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

drop policy if exists "vehicle_selection_insert_active_deal_members"
on public.vehicle_selection;

create policy "vehicle_selection_insert_active_deal_members"
on public.vehicle_selection
for insert
to authenticated
with check (
  (selected_by is null or selected_by = auth.uid())
  and exists (
    select 1
    from public.deals d
    where d.id = vehicle_selection.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
  and exists (
    select 1
    from public.vehicle_options vo
    where vo.id = vehicle_selection.vehicle_option_id
      and vo.deal_id = vehicle_selection.deal_id
  )
);

drop policy if exists "vehicle_selection_update_active_deal_members"
on public.vehicle_selection;

create policy "vehicle_selection_update_active_deal_members"
on public.vehicle_selection
for update
to authenticated
using (
  exists (
    select 1
    from public.deals d
    where d.id = vehicle_selection.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
)
with check (
  (selected_by is null or selected_by = auth.uid())
  and exists (
    select 1
    from public.deals d
    where d.id = vehicle_selection.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
  and exists (
    select 1
    from public.vehicle_options vo
    where vo.id = vehicle_selection.vehicle_option_id
      and vo.deal_id = vehicle_selection.deal_id
  )
);

drop policy if exists "vehicle_selection_delete_active_deal_members"
on public.vehicle_selection;

create policy "vehicle_selection_delete_active_deal_members"
on public.vehicle_selection
for delete
to authenticated
using (
  exists (
    select 1
    from public.deals d
    where d.id = vehicle_selection.deal_id
      and d.organization_id is not null
      and public.is_active_organization_member(d.organization_id)
  )
);

commit;
