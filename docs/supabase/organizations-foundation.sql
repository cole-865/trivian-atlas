begin;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.organization_users (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('sales', 'management', 'admin', 'dev')),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (organization_id, user_id)
);

create table if not exists public.organization_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value_json jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (organization_id, key)
);

create index if not exists organization_users_user_id_idx
  on public.organization_users (user_id);

create index if not exists organization_users_role_idx
  on public.organization_users (organization_id, role)
  where is_active = true;

create index if not exists organization_settings_key_idx
  on public.organization_settings (organization_id, key);

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists organization_users_set_updated_at on public.organization_users;
create trigger organization_users_set_updated_at
before update on public.organization_users
for each row
execute function public.set_current_timestamp_updated_at();

create or replace function public.is_active_organization_member(
  p_organization_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_users ou
    join public.organizations o
      on o.id = ou.organization_id
    where ou.organization_id = p_organization_id
      and ou.user_id = coalesce(p_user_id, auth.uid())
      and ou.is_active = true
      and o.is_active = true
  );
$$;

create or replace function public.has_organization_role(
  p_organization_id uuid,
  p_roles text[],
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_users ou
    join public.organizations o
      on o.id = ou.organization_id
    where ou.organization_id = p_organization_id
      and ou.user_id = coalesce(p_user_id, auth.uid())
      and ou.is_active = true
      and o.is_active = true
      and ou.role = any(p_roles)
  );
$$;

grant execute on function public.is_active_organization_member(uuid, uuid) to authenticated;
grant execute on function public.has_organization_role(uuid, text[], uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_users enable row level security;
alter table public.organization_settings enable row level security;

drop policy if exists "organizations_select_active_memberships" on public.organizations;
create policy "organizations_select_active_memberships"
on public.organizations
for select
to authenticated
using (
  is_active = true
  and public.is_active_organization_member(id)
);

drop policy if exists "organization_users_select_self_or_org_admins" on public.organization_users;
create policy "organization_users_select_self_or_org_admins"
on public.organization_users
for select
to authenticated
using (
  user_id = auth.uid()
  or public.has_organization_role(organization_id, array['admin', 'dev'])
);

drop policy if exists "organization_users_manage_org_admins" on public.organization_users;
create policy "organization_users_manage_org_admins"
on public.organization_users
for all
to authenticated
using (
  public.has_organization_role(organization_id, array['admin', 'dev'])
)
with check (
  public.has_organization_role(organization_id, array['admin', 'dev'])
);

drop policy if exists "organization_settings_select_active_members" on public.organization_settings;
create policy "organization_settings_select_active_members"
on public.organization_settings
for select
to authenticated
using (
  public.is_active_organization_member(organization_id)
);

drop policy if exists "organization_settings_manage_admins" on public.organization_settings;
create policy "organization_settings_manage_admins"
on public.organization_settings
for all
to authenticated
using (
  public.has_organization_role(organization_id, array['admin', 'dev'])
)
with check (
  public.has_organization_role(organization_id, array['admin', 'dev'])
);

commit;
