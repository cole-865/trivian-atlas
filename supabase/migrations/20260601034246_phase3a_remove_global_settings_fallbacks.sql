begin;

insert into public.organization_settings (
    organization_id,
    key,
    value_json,
    updated_at
)
select
    org.id,
    'workflow',
    jsonb_build_object(
        'stepEnforcementEnabled',
        coalesce(
            case
                when jsonb_typeof(legacy_step.value_json) = 'boolean'
                    then (legacy_step.value_json #>> '{}')::boolean
                else null
            end,
            case
                when jsonb_typeof(global_step.value_json) = 'boolean'
                    then (global_step.value_json #>> '{}')::boolean
                else null
            end,
            true
        ),
        'requireCreditBureauBeforeSubmit', true,
        'requireCustomerBeforeIncome', false,
        'requireUnderwritingDecisionBeforeVehicle', true,
        'allowAdminBypass', true,
        'lockCompletedStepsAfterSubmit', false,
        'requireManagerApprovalToReopenSubmittedDeals', false
    ),
    now()
from public.organizations org
left join public.organization_settings existing_workflow
    on existing_workflow.organization_id = org.id
    and existing_workflow.key = 'workflow'
left join public.organization_settings legacy_step
    on legacy_step.organization_id = org.id
    and legacy_step.key = 'step_enforcement_enabled'
left join public.app_settings global_step
    on global_step.key = 'step_enforcement_enabled'
where org.is_active = true
  and existing_workflow.organization_id is null;

with source_config as (
    select
        payment_cap_pct,
        apr,
        tax_rate_main,
        tax_add_base,
        tax_add_rate,
        vsc_price,
        gap_price,
        doc_fee,
        title_license
    from public.trivian_config
    where organization_id is null
    order by created_at desc
    limit 1
)
insert into public.trivian_config (
    organization_id,
    payment_cap_pct,
    apr,
    tax_rate_main,
    tax_add_base,
    tax_add_rate,
    vsc_price,
    gap_price,
    doc_fee,
    title_license
)
select
    org.id,
    coalesce(source_config.payment_cap_pct, 0.22),
    coalesce(source_config.apr, 0.2699),
    coalesce(source_config.tax_rate_main, 0.07),
    coalesce(source_config.tax_add_base, 3200),
    coalesce(source_config.tax_add_rate, 0.0275),
    coalesce(source_config.vsc_price, 1799),
    coalesce(source_config.gap_price, 599),
    coalesce(source_config.doc_fee, 699),
    coalesce(source_config.title_license, 196.50)
from public.organizations org
left join public.trivian_config existing_config
    on existing_config.organization_id = org.id
left join source_config on true
where org.is_active = true
  and existing_config.organization_id is null;

drop policy if exists "authenticated users can read app settings" on public.app_settings;
drop policy if exists "admin and dev can insert app settings" on public.app_settings;
drop policy if exists "admin and dev can update app settings" on public.app_settings;

create policy "app_settings_select_platform_dev"
on public.app_settings
for select
to authenticated
using ((select public.current_app_role()) = 'dev');

create policy "app_settings_insert_platform_dev"
on public.app_settings
for insert
to authenticated
with check ((select public.current_app_role()) = 'dev');

create policy "app_settings_update_platform_dev"
on public.app_settings
for update
to authenticated
using ((select public.current_app_role()) = 'dev')
with check ((select public.current_app_role()) = 'dev');

create policy "app_settings_delete_platform_dev"
on public.app_settings
for delete
to authenticated
using ((select public.current_app_role()) = 'dev');

drop policy if exists "config_read" on public.trivian_config;
drop policy if exists "config_update" on public.trivian_config;
drop policy if exists "trivian_config_select_active_members" on public.trivian_config;

create policy "trivian_config_select_active_members"
on public.trivian_config
for select
to authenticated
using (
    organization_id is not null
    and public.is_active_organization_member(organization_id)
);

commit;
