begin;
-- Module entitlements are platform-managed. Browser roles receive no direct access.
create table public.organization_modules (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 module_key text not null check (module_key in ('ask865')),
 enabled boolean not null default false,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id),
 primary key (organization_id,module_key)
);
alter table public.organization_modules enable row level security;
revoke all on public.organization_modules from public, anon, authenticated;
grant select, insert, update on public.organization_modules to service_role;
insert into public.organization_modules(organization_id,module_key,enabled)
 select id,'ask865',true from public.organizations where slug='865-autos';
alter table public.organization_role_permissions drop constraint organization_role_permissions_permission_key_check;
alter table public.organization_role_permissions add constraint organization_role_permissions_permission_key_check check(permission_key in ('view_deals','edit_deals','submit_deals','fund_deals','approve_overrides','manage_users','manage_underwriting_settings','manage_workflow_settings','view_audit_logs','manage_integrations','export_reports','view_ask865','review_ask865_sources'));
alter table public.organization_user_permission_overrides drop constraint organization_user_permission_overrides_permission_key_check;
alter table public.organization_user_permission_overrides add constraint organization_user_permission_overrides_permission_key_check check(permission_key in ('view_deals','edit_deals','submit_deals','fund_deals','approve_overrides','manage_users','manage_underwriting_settings','manage_workflow_settings','view_audit_logs','manage_integrations','export_reports','view_ask865','review_ask865_sources'));
insert into public.organization_role_permissions(organization_id,role,permission_key,allowed)
select o.id,r.role,p.permission_key,
 case when p.permission_key='view_ask865' then r.role in ('admin','management') else r.role='admin' end
from public.organizations o cross join (values ('sales'),('management'),('admin')) r(role)
cross join (values ('view_ask865'),('review_ask865_sources')) p(permission_key)
on conflict(organization_id,role,permission_key) do nothing;

-- The imported legacy schema is constrained to one organization on every table.
-- Views aggregate this single-organization source. Require its actual owner AND
-- the module entitlement before any view is read. A toggle cannot connect another
-- dealership to 865 Autos data. Service role only; no browser-callable RPC.
grant usage on schema ask865 to service_role;
grant select on ask865.report_definitions, ask865.source_issue_register to service_role;
grant select on ask865.v_dashboard_attention_items, ask865.v_dashboard_bhph_summary, ask865.v_dashboard_import_health, ask865.v_dashboard_inventory, ask865.v_shopware_sales_monthly, ask865.v_sold_deals_bi to service_role;
create function public.atlas_ask865_dashboard(p_organization_id uuid,p_from date,p_to date,
 p_salesperson text default '',p_lender text default '',p_inventory_status text default '')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb := '{}'::jsonb;
begin
if not exists (
 select 1 from public.organization_modules m
 join public.organizations o on o.id=m.organization_id and o.is_active
 where m.organization_id=p_organization_id and m.module_key='ask865' and m.enabled
) or not exists (select 1 from ask865.report_definitions where organization_id=p_organization_id) then
 raise exception 'Ask 865 is unavailable for this organization' using errcode='42501';
end if;
if p_from is null or p_to is null or p_to < p_from or p_to-p_from > 3650
 or length(p_salesperson)>160 or length(p_lender)>160 or length(p_inventory_status)>160 then
 raise exception 'Invalid reporting filters' using errcode='22023';
end if;
select result || jsonb_build_object('summary',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select
       count(*)::bigint as units_sold,
       count(*) filter (where deal_type = 'FINANCE')::bigint as finance_units,
       count(*) filter (where deal_type = 'CASH')::bigint as cash_units,
       count(*) filter (where deal_type = 'BHPH')::bigint as bhph_units,
       count(*) filter (where deal_type = 'WHOLESALE')::bigint as wholesale_units,
       count(*) filter (where deal_type = 'FINANCE' and nullif(trim(lender_name), '') is not null)::bigint as finance_with_lender,
       count(distinct nullif(trim(lender_name), '')) filter (where deal_type = 'FINANCE')::bigint as finance_lenders_used,
       count(credit_score) filter (where deal_type = 'FINANCE')::bigint as finance_deals_with_score,
       avg(credit_score) filter (where deal_type = 'FINANCE')::numeric(10,2) as finance_average_credit_score,
       coalesce(sum(back_gross) filter (where deal_type = 'FINANCE'), 0)::numeric(16,2) as finance_back_gross,
       coalesce(sum(front_gross), 0)::numeric(16,2) as front_gross,
       coalesce(sum(back_gross), 0)::numeric(16,2) as back_gross,
       coalesce(sum(total_gross), 0)::numeric(16,2) as total_gross,
       coalesce(avg(total_gross), 0)::numeric(16,2) as average_gross,
       coalesce(sum(vehicle_price), 0)::numeric(16,2) as vehicle_sales,
       coalesce(sum(total_vehicle_cost), 0)::numeric(16,2) as vehicle_cost
     from ask865.v_sold_deals_bi
     where deal_date between p_from and p_to
 and (p_salesperson = '' or coalesce(nullif(trim(salesperson1_name), ''), '(Unassigned)') = p_salesperson)
 and (p_lender = '' or coalesce(nullif(trim(lender_name), ''), '(Missing lender)') = p_lender)) report_row;
select result || jsonb_build_object('monthly',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select to_char(date_trunc('month', deal_date), 'YYYY-MM') as month,
              count(*)::bigint as units,
              coalesce(sum(front_gross), 0)::numeric(16,2) as front_gross,
              coalesce(sum(back_gross), 0)::numeric(16,2) as back_gross,
              coalesce(sum(total_gross), 0)::numeric(16,2) as total_gross
       from ask865.v_sold_deals_bi where deal_date between p_from and p_to
 and (p_salesperson = '' or coalesce(nullif(trim(salesperson1_name), ''), '(Unassigned)') = p_salesperson)
 and (p_lender = '' or coalesce(nullif(trim(lender_name), ''), '(Missing lender)') = p_lender)
       group by date_trunc('month', deal_date) order by date_trunc('month', deal_date)) report_row;
select result || jsonb_build_object('salespeople',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select coalesce(nullif(trim(salesperson1_name), ''), '(Unassigned)') as name,
              count(*)::bigint as units,
              coalesce(sum(total_gross), 0)::numeric(16,2) as total_gross
       from ask865.v_sold_deals_bi where deal_date between p_from and p_to
 and (p_salesperson = '' or coalesce(nullif(trim(salesperson1_name), ''), '(Unassigned)') = p_salesperson)
 and (p_lender = '' or coalesce(nullif(trim(lender_name), ''), '(Missing lender)') = p_lender)
       group by 1 order by total_gross desc, units desc) report_row;
select result || jsonb_build_object('lenders',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select coalesce(nullif(trim(lender_name), ''), '(Missing lender)') as name,
              count(*)::bigint as deals,
              coalesce(sum(financed_amount), 0)::numeric(16,2) as amount_financed,
              coalesce(sum(total_gross), 0)::numeric(16,2) as total_gross,
              avg(credit_score)::numeric(10,2) as average_credit_score
       from ask865.v_sold_deals_bi where deal_date between p_from and p_to
 and (p_salesperson = '' or coalesce(nullif(trim(salesperson1_name), ''), '(Unassigned)') = p_salesperson)
 and (p_lender = '' or coalesce(nullif(trim(lender_name), ''), '(Missing lender)') = p_lender) and deal_type = 'FINANCE'
       group by 1 order by deals desc, amount_financed desc) report_row;
select result || jsonb_build_object('scoreBands',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select case
                when credit_score is null then 'No score'
                when credit_score < 500 then '<500'
                when credit_score < 550 then '500-549'
                when credit_score < 600 then '550-599'
                when credit_score < 650 then '600-649'
                when credit_score < 700 then '650-699'
                when credit_score < 750 then '700-749'
                when credit_score < 800 then '750-799'
                when credit_score < 850 then '800-849'
                else '850+'
              end as band,
              case
                when credit_score is null then 10
                when credit_score < 500 then 1 when credit_score < 550 then 2
                when credit_score < 600 then 3 when credit_score < 650 then 4
                when credit_score < 700 then 5 when credit_score < 750 then 6
                when credit_score < 800 then 7 when credit_score < 850 then 8 else 9
              end as sort,
              count(*)::bigint as deals
       from ask865.v_sold_deals_bi where deal_date between p_from and p_to
 and (p_salesperson = '' or coalesce(nullif(trim(salesperson1_name), ''), '(Unassigned)') = p_salesperson)
 and (p_lender = '' or coalesce(nullif(trim(lender_name), ''), '(Missing lender)') = p_lender) and deal_type = 'FINANCE'
       group by 1, 2 order by sort) report_row;
select result || jsonb_build_object('leadSources',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select coalesce(nullif(trim(lead_source), ''), '(Unattributed)') as name,
              count(*)::bigint as sold_deals,
              coalesce(sum(total_gross), 0)::numeric(16,2) as total_gross
       from ask865.v_sold_deals_bi where deal_date between p_from and p_to
 and (p_salesperson = '' or coalesce(nullif(trim(salesperson1_name), ''), '(Unassigned)') = p_salesperson)
 and (p_lender = '' or coalesce(nullif(trim(lender_name), ''), '(Missing lender)') = p_lender)
       group by 1 order by sold_deals desc, total_gross desc) report_row;
select result || jsonb_build_object('bhph',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select event_type, records, amount, balance, latest_event_date, snapshot_at
       from ask865.v_dashboard_bhph_summary
       order by balance desc, amount desc, event_type) report_row;
select result || jsonb_build_object('aging',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select aging_bucket as bucket, aging_sort as sort, count(*)::bigint as units,
              coalesce(sum(total_cost), 0)::numeric(16,2) as total_cost
       from ask865.v_dashboard_inventory where (p_inventory_status = '' or coalesce(nullif(trim(status), ''), '(Unknown)') = p_inventory_status)
       group by aging_bucket, aging_sort order by aging_sort) report_row;
select result || jsonb_build_object('inventory',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select stock_no, vin, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, status,
              purchase_date, date_in_stock, days_in_inventory, days_available_for_sale,
              days_from_purchase_to_sale_ready, asking_price, advertising_price, total_cost,
              potential_gross, vehicle_purchase_source, purchased_from, title_status,
              inspection_status, days_in_recon, is_floored, flooring_company, amount_floored
       from ask865.v_dashboard_inventory where (p_inventory_status = '' or coalesce(nullif(trim(status), ''), '(Unknown)') = p_inventory_status)
       order by days_in_inventory desc nulls last, stock_no) report_row;
select result || jsonb_build_object('attention',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select priority_rank, priority, category, entity_type, entity_id, event_date, amount, summary, detail
       from ask865.v_dashboard_attention_items
       order by priority_rank, event_date nulls last, category, entity_id) report_row;
select result || jsonb_build_object('deals',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select deal_no, deal_date, stock_no, vin, vehicle_year, vehicle_make, vehicle_model,
              vehicle_trim, deal_type, days_in_stock as days_old,
              vehicle_total_cost_adds as total_recon,
              salesperson1_name, lender_name, credit_score,
              vehicle_price, total_vehicle_cost, front_gross, back_gross, total_gross, financed_amount
       from ask865.v_sold_deals_bi where deal_date between p_from and p_to
 and (p_salesperson = '' or coalesce(nullif(trim(salesperson1_name), ''), '(Unassigned)') = p_salesperson)
 and (p_lender = '' or coalesce(nullif(trim(lender_name), ''), '(Missing lender)') = p_lender)
       order by deal_date desc, deal_no desc) report_row;
select result || jsonb_build_object('choices',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select 'salesperson' as kind, coalesce(nullif(trim(salesperson1_name), ''), '(Unassigned)') as value
         from ask865.v_sold_deals_bi group by 2
       union all
       select 'lender', coalesce(nullif(trim(lender_name), ''), '(Missing lender)')
         from ask865.v_sold_deals_bi where deal_type = 'FINANCE' group by 2
       union all
       select 'inventory_status', coalesce(nullif(trim(status), ''), '(Unknown)')
         from ask865.v_dashboard_inventory group by 2
       order by kind, value) report_row;
select result || jsonb_build_object('freshness',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select (select max(last_seen_at) from ask865.v_sold_deals_bi) as sold_updated_at,
              (select max(snapshot_at) from ask865.v_dashboard_inventory) as inventory_updated_at,
              (select max(deal_date) from ask865.v_sold_deals_bi) as latest_deal_date) report_row;
select result || jsonb_build_object('importHealth',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select * from ask865.v_dashboard_import_health order by canonical_name) report_row;
select result || jsonb_build_object('sourceIssues',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select * from ask865.source_issue_register where organization_id = p_organization_id order by resolved_at nulls first, report_key, issue_code) report_row;
select result || jsonb_build_object('priorSummary',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (select
       count(*)::bigint as units_sold,
       count(*) filter (where deal_type = 'FINANCE')::bigint as finance_units,
       count(*) filter (where deal_type = 'CASH')::bigint as cash_units,
       count(*) filter (where deal_type = 'BHPH')::bigint as bhph_units,
       count(*) filter (where deal_type = 'WHOLESALE')::bigint as wholesale_units,
       count(*) filter (where deal_type = 'FINANCE' and nullif(trim(lender_name), '') is not null)::bigint as finance_with_lender,
       count(distinct nullif(trim(lender_name), '')) filter (where deal_type = 'FINANCE')::bigint as finance_lenders_used,
       count(credit_score) filter (where deal_type = 'FINANCE')::bigint as finance_deals_with_score,
       avg(credit_score) filter (where deal_type = 'FINANCE')::numeric(10,2) as finance_average_credit_score,
       coalesce(sum(back_gross) filter (where deal_type = 'FINANCE'), 0)::numeric(16,2) as finance_back_gross,
       coalesce(sum(front_gross), 0)::numeric(16,2) as front_gross,
       coalesce(sum(back_gross), 0)::numeric(16,2) as back_gross,
       coalesce(sum(total_gross), 0)::numeric(16,2) as total_gross,
       coalesce(avg(total_gross), 0)::numeric(16,2) as average_gross,
       coalesce(sum(vehicle_price), 0)::numeric(16,2) as vehicle_sales,
       coalesce(sum(total_vehicle_cost), 0)::numeric(16,2) as vehicle_cost
     from ask865.v_sold_deals_bi
     where deal_date between p_from - (p_to - p_from + 1) and p_from - 1
 and (p_salesperson = '' or coalesce(nullif(trim(salesperson1_name), ''), '(Unassigned)') = p_salesperson)
 and (p_lender = '' or coalesce(nullif(trim(lender_name), ''), '(Missing lender)') = p_lender)) report_row;
select result || jsonb_build_object('service',coalesce(jsonb_agg(to_jsonb(report_row)),'[]'::jsonb)) into result
from (
    select to_char(month, 'YYYY-MM') as month, billing_group,
           closed_orders, sales_before_tax, tax, sales_with_tax,
           labor_after_discount, parts_and_tires_after_discount, sublets, fees
    from ask865.v_shopware_sales_monthly
    where month >= date '2026-01-01' and month < date '2027-01-01'
    order by month, billing_group
  ) report_row;
return result;
end $$;
revoke all on function public.atlas_ask865_dashboard(uuid,date,date,text,text,text) from public,anon,authenticated;
grant execute on function public.atlas_ask865_dashboard(uuid,date,date,text,text,text) to service_role;

grant update(owner_name,notes,review_status,updated_by,updated_at) on ask865.source_issue_register to service_role;
create function public.atlas_ask865_review(p_organization_id uuid,p_report_key text,p_issue_code text,
 p_owner text,p_notes text,p_status text,p_actor text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
if not exists (
 select 1 from public.organization_modules m
 join public.organizations o on o.id=m.organization_id and o.is_active
 where m.organization_id=p_organization_id and m.module_key='ask865' and m.enabled
) or not exists (select 1 from ask865.report_definitions where organization_id=p_organization_id) then
 raise exception 'Ask 865 is unavailable for this organization' using errcode='42501';
end if;
if p_status not in ('open','in_review') or p_status is null
 or length(p_owner)>160 or length(p_notes)>2000 or length(p_report_key)>160 or length(p_issue_code)>200
 or p_owner is null or p_notes is null or p_actor is null then
 raise exception 'Invalid review' using errcode='22023';
end if;
update ask865.source_issue_register set owner_name=p_owner,notes=p_notes,review_status=p_status,
 updated_by=p_actor,updated_at=now()
 where organization_id=p_organization_id and report_key=p_report_key and issue_code=p_issue_code;
return found;
end $$;
revoke all on function public.atlas_ask865_review(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.atlas_ask865_review(uuid,text,text,text,text,text,text) to service_role;
commit;
