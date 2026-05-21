begin;

-- Phase 1 hardening only:
-- - remove legacy permissive authenticated policies that were introduced in the
--   baseline dump and have tracked organization/member-scoped replacements.
-- - revoke direct public/anon/authenticated execution on confirmed-unused
--   legacy SQL helper functions.
-- This intentionally does not drop legacy tables/functions or change nullable
-- organization_id columns.
-- TODO before production removal: live-validate replacement policies and row
-- usage before dropping legacy anon-dev or legacy-table policies such as
-- audit_log_all_authenticated, documents_all_authenticated,
-- vehicle_options_all_authenticated, and vehicle_selection_all_authenticated.

do $$
declare
  item record;
  target_relation regclass;
begin
  for item in
    select *
    from (
      values
        ('public.deal_people', 'deal_people_all_authenticated'),
        ('public.deal_people', 'deal_people_insert_auth'),
        ('public.deal_people', 'deal_people_select_auth'),
        ('public.deal_people', 'deal_people_update_auth'),
        ('public.deals', 'deals_all_authenticated'),
        ('public.deals', 'deals_insert_auth'),
        ('public.deals', 'deals_select_auth'),
        ('public.deals', 'deals_update_auth'),
        ('public.income_profiles', 'income_profiles_all_authenticated'),
        ('public.income_profiles', 'income_profiles_insert_auth'),
        ('public.income_profiles', 'income_profiles_select_auth'),
        ('public.income_profiles', 'income_profiles_update_auth')
    ) as policies(table_name, policy_name)
  loop
    target_relation := to_regclass(item.table_name);

    if target_relation is not null then
      execute format(
        'drop policy if exists %I on %s',
        item.policy_name,
        item.table_name
      );
    end if;
  end loop;
end $$;

do $$
declare
  item record;
  target_function regprocedure;
  deprecated_note text := 'Deprecated Atlas legacy SQL helper. Direct public/anon/authenticated execution was revoked in 20260521031120; keep only for migration compatibility until Phase 2 cleanup confirms removal safety.';
begin
  for item in
    select *
    from (
      values
        ('public.atlas_dashboard_metrics()'),
        ('public.bhph_evaluate_bureau(uuid)'),
        ('public.trivian_amount_financed(numeric, boolean, boolean, numeric)'),
        ('public.trivian_get_config()'),
        ('public.trivian_inventory_pricing(numeric, integer, boolean, boolean, numeric)'),
        ('public.trivian_max_amount_financed(numeric, integer)'),
        ('public.trivian_max_payment(numeric)'),
        ('public.trivian_monthly_payment(numeric, integer)'),
        ('public.trivian_qualifying_units(numeric, integer, boolean, boolean, numeric)'),
        ('public.trivian_quote(numeric, numeric, integer, boolean, boolean, numeric)'),
        ('public.trivian_tax_amount(numeric)'),
        ('public.trivian_tax_amount(numeric, boolean)')
    ) as functions(function_signature)
  loop
    target_function := to_regprocedure(item.function_signature);

    if target_function is not null then
      execute format(
        'revoke execute on function %s from public, anon, authenticated',
        target_function
      );
      execute format(
        'comment on function %s is %L',
        target_function,
        deprecated_note
      );
    end if;
  end loop;
end $$;

commit;
