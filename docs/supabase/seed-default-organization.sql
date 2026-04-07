-- Update owner_email before running this in production.
-- This script creates the initial dealership organization, backfills current
-- active staff memberships from public.user_profiles, and seeds the
-- organization-scoped step enforcement setting from public.app_settings.

begin;

with defaults as (
  select
    '865 Autos'::text as organization_name,
    '865-autos'::text as organization_slug,
    'replace-with-your-email@example.com'::text as owner_email
),
upsert_organization as (
  insert into public.organizations (name, slug)
  select organization_name, organization_slug
  from defaults
  on conflict (slug) do update
  set
    name = excluded.name,
    is_active = true,
    updated_at = timezone('utc', now())
  returning id, slug
),
resolved_organization as (
  select id
  from upsert_organization
  union all
  select o.id
  from public.organizations o
  join defaults d
    on d.organization_slug = o.slug
  limit 1
),
membership_candidates as (
  select
    up.id as user_id,
    up.role::text as role,
    up.is_active,
    coalesce(up.created_at, timezone('utc', now())) as created_at,
    1 as priority
  from public.user_profiles up
  where up.is_active = true

  union all

  select
    au.id as user_id,
    'dev'::text as role,
    true as is_active,
    timezone('utc', now()) as created_at,
    0 as priority
  from auth.users au
  join defaults d
    on lower(au.email) = lower(d.owner_email)
),
resolved_memberships as (
  select distinct on (mc.user_id)
    mc.user_id,
    mc.role,
    mc.is_active,
    mc.created_at
  from membership_candidates mc
  order by mc.user_id, mc.priority
),
upsert_memberships as (
  insert into public.organization_users (
    organization_id,
    user_id,
    role,
    is_active,
    created_at,
    updated_at
  )
  select
    ro.id,
    rm.user_id,
    rm.role,
    rm.is_active,
    rm.created_at,
    timezone('utc', now())
  from resolved_organization ro
  join resolved_memberships rm
    on true
  on conflict (organization_id, user_id) do update
  set
    role = excluded.role,
    is_active = excluded.is_active,
    updated_at = timezone('utc', now())
  returning organization_id
)
insert into public.organization_settings (
  organization_id,
  key,
  value_json,
  updated_at
)
select
  ro.id,
  'step_enforcement_enabled',
  coalesce(app_setting.value_json, 'true'::jsonb),
  timezone('utc', now())
from resolved_organization ro
left join public.app_settings app_setting
  on app_setting.key = 'step_enforcement_enabled'
on conflict (organization_id, key) do update
set
  value_json = excluded.value_json,
  updated_at = timezone('utc', now());

commit;

-- Optional verification:
-- select o.id, o.name, o.slug, ou.user_id, ou.role, ou.is_active
-- from public.organizations o
-- left join public.organization_users ou
--   on ou.organization_id = o.id
-- where o.slug = '865-autos'
-- order by ou.role, ou.user_id;
