with public_tables as (
  select
    n.nspname as schema_name,
    c.relname as table_name,
    c.oid::regclass as relation_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
),
policy_summary as (
  select
    p.polrelid,
    count(*) as policy_count,
    count(*) filter (where p.polpermissive) as permissive_policy_count,
    count(*) filter (where not p.polpermissive) as restrictive_policy_count
  from pg_policy p
  group by p.polrelid
),
organization_column_summary as (
  select
    a.attrelid,
    count(*) filter (
      where a.attname = 'organization_id'
        and not a.attisdropped
    ) as organization_column_count
  from pg_attribute a
  group by a.attrelid
)
select
  'public_table_rls' as audit_section,
  pt.schema_name,
  pt.table_name,
  pt.relation_name::text as relation_name,
  pt.rls_enabled::text as result_value
from public_tables pt
where not pt.rls_enabled

union all

select
  'public_table_policy_count' as audit_section,
  pt.schema_name,
  pt.table_name,
  pt.relation_name::text as relation_name,
  coalesce(ps.policy_count, 0)::text as result_value
from public_tables pt
left join policy_summary ps on ps.polrelid = pt.relation_name
where coalesce(ps.policy_count, 0) = 0

union all

select
  'public_table_permissive_policy_count' as audit_section,
  pt.schema_name,
  pt.table_name,
  pt.relation_name::text as relation_name,
  coalesce(ps.permissive_policy_count, 0)::text as result_value
from public_tables pt
left join policy_summary ps on ps.polrelid = pt.relation_name
where coalesce(ps.permissive_policy_count, 0) > 0

union all

select
  'public_table_org_column_count' as audit_section,
  pt.schema_name,
  pt.table_name,
  pt.relation_name::text as relation_name,
  coalesce(ocs.organization_column_count, 0)::text as result_value
from public_tables pt
left join organization_column_summary ocs on ocs.attrelid = pt.relation_name
where coalesce(ocs.organization_column_count, 0) = 0
order by audit_section, schema_name, table_name;
