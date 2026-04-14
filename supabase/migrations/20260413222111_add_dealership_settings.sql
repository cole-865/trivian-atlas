begin;

create table if not exists public.organization_profile_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  legal_business_name text null,
  dba_name text null,
  phone text null,
  website text null,
  main_email text null,
  address_line1 text null,
  address_line2 text null,
  city text null,
  state text null,
  postal_code text null,
  country text null default 'US',
  timezone text null default 'America/New_York',
  logo_storage_path text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.organization_role_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('sales', 'management', 'admin')),
  permission_key text not null check (
    permission_key in (
      'view_deals',
      'edit_deals',
      'submit_deals',
      'approve_overrides',
      'manage_users',
      'manage_underwriting_settings',
      'manage_workflow_settings',
      'view_audit_logs',
      'manage_integrations',
      'export_reports'
    )
  ),
  allowed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (organization_id, role, permission_key)
);

create table if not exists public.organization_user_permission_overrides (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null check (
    permission_key in (
      'view_deals',
      'edit_deals',
      'submit_deals',
      'approve_overrides',
      'manage_users',
      'manage_underwriting_settings',
      'manage_workflow_settings',
      'view_audit_logs',
      'manage_integrations',
      'export_reports'
    )
  ),
  allowed boolean not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (organization_id, user_id, permission_key)
);

insert into public.organization_role_permissions (
  organization_id,
  role,
  permission_key,
  allowed
)
select
  org.id,
  role_permissions.role,
  role_permissions.permission_key,
  role_permissions.allowed
from public.organizations org
cross join (
  values
    ('sales', 'view_deals', true),
    ('sales', 'edit_deals', true),
    ('sales', 'submit_deals', true),
    ('sales', 'approve_overrides', false),
    ('sales', 'manage_users', false),
    ('sales', 'manage_underwriting_settings', false),
    ('sales', 'manage_workflow_settings', false),
    ('sales', 'view_audit_logs', false),
    ('sales', 'manage_integrations', false),
    ('sales', 'export_reports', false),
    ('management', 'view_deals', true),
    ('management', 'edit_deals', true),
    ('management', 'submit_deals', true),
    ('management', 'approve_overrides', true),
    ('management', 'manage_users', false),
    ('management', 'manage_underwriting_settings', false),
    ('management', 'manage_workflow_settings', false),
    ('management', 'view_audit_logs', false),
    ('management', 'manage_integrations', false),
    ('management', 'export_reports', false),
    ('admin', 'view_deals', true),
    ('admin', 'edit_deals', true),
    ('admin', 'submit_deals', true),
    ('admin', 'approve_overrides', true),
    ('admin', 'manage_users', true),
    ('admin', 'manage_underwriting_settings', true),
    ('admin', 'manage_workflow_settings', true),
    ('admin', 'view_audit_logs', true),
    ('admin', 'manage_integrations', true),
    ('admin', 'export_reports', true)
) as role_permissions(role, permission_key, allowed)
on conflict (organization_id, role, permission_key) do nothing;

insert into public.organization_user_permission_overrides (
  organization_id,
  user_id,
  permission_key,
  allowed
)
select
  organization_id,
  user_id,
  'approve_overrides',
  true
from public.organization_users
where can_approve_deal_overrides = true
on conflict (organization_id, user_id, permission_key) do update
set
  allowed = excluded.allowed,
  updated_at = timezone('utc', now());

alter table public.audit_log
  add column if not exists organization_id uuid null references public.organizations(id) on delete set null,
  add column if not exists changed_by_user_id uuid null references auth.users(id) on delete set null,
  add column if not exists change_type text null,
  add column if not exists entity_type text null,
  add column if not exists before jsonb null,
  add column if not exists after jsonb null;

update public.audit_log
set
  changed_by_user_id = coalesce(changed_by_user_id, actor_id),
  change_type = coalesce(change_type, action),
  entity_type = coalesce(entity_type, 'legacy'),
  after = coalesce(after, meta)
where changed_by_user_id is null
  or change_type is null
  or entity_type is null
  or after is null;

create index if not exists organization_profile_settings_updated_idx
  on public.organization_profile_settings (organization_id, updated_at desc);

create index if not exists organization_user_permission_overrides_user_idx
  on public.organization_user_permission_overrides (organization_id, user_id);

create index if not exists audit_log_organization_created_idx
  on public.audit_log (organization_id, created_at desc);

alter table public.organization_profile_settings enable row level security;
alter table public.organization_role_permissions enable row level security;
alter table public.organization_user_permission_overrides enable row level security;
alter table public.organization_settings enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists "organization_profile_settings_select_org_members"
on public.organization_profile_settings;
create policy "organization_profile_settings_select_org_members"
on public.organization_profile_settings
for select
to authenticated
using (
  public.atlas_is_active_organization_member(organization_id)
);

drop policy if exists "organization_role_permissions_select_org_members"
on public.organization_role_permissions;
create policy "organization_role_permissions_select_org_members"
on public.organization_role_permissions
for select
to authenticated
using (
  public.atlas_is_active_organization_member(organization_id)
);

drop policy if exists "organization_user_permission_overrides_select_org_members"
on public.organization_user_permission_overrides;
create policy "organization_user_permission_overrides_select_org_members"
on public.organization_user_permission_overrides
for select
to authenticated
using (
  public.atlas_is_active_organization_member(organization_id)
);

drop policy if exists "organization_settings_select_org_members"
on public.organization_settings;
create policy "organization_settings_select_org_members"
on public.organization_settings
for select
to authenticated
using (
  public.atlas_is_active_organization_member(organization_id)
);

drop policy if exists "audit_log_select_org_members"
on public.audit_log;
create policy "audit_log_select_org_members"
on public.audit_log
for select
to authenticated
using (
  organization_id is null
  or public.atlas_is_active_organization_member(organization_id)
);

commit;
