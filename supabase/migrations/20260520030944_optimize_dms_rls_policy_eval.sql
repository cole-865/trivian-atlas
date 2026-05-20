begin;

drop policy if exists "dms_import_batches_select_raw_managers"
on public.dms_import_batches;

create policy "dms_import_batches_select_raw_managers"
on public.dms_import_batches
for select
to authenticated
using (
  (select public.current_app_role()) = 'dev'
  or public.has_organization_role(organization_id, array['management', 'admin'])
);

drop policy if exists "dms_accounts_snapshot_select_raw_managers"
on public.dms_accounts_snapshot;

create policy "dms_accounts_snapshot_select_raw_managers"
on public.dms_accounts_snapshot
for select
to authenticated
using (
  (select public.current_app_role()) = 'dev'
  or public.has_organization_role(organization_id, array['management', 'admin'])
);

drop policy if exists "dms_payment_ledger_select_raw_managers"
on public.dms_payment_ledger;

create policy "dms_payment_ledger_select_raw_managers"
on public.dms_payment_ledger
for select
to authenticated
using (
  (select public.current_app_role()) = 'dev'
  or public.has_organization_role(organization_id, array['management', 'admin'])
);

drop policy if exists "dms_activity_events_select_raw_managers"
on public.dms_activity_events;

create policy "dms_activity_events_select_raw_managers"
on public.dms_activity_events
for select
to authenticated
using (
  (select public.current_app_role()) = 'dev'
  or public.has_organization_role(organization_id, array['management', 'admin'])
);

commit;
