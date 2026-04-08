begin;

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  full_name text null,
  role text not null check (role in ('sales', 'management', 'admin')),
  invited_by_user_id uuid null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null,
  accepted_at timestamptz null,
  accepted_by_user_id uuid null,
  revoked_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists organization_users_organization_user_uidx
  on public.organization_users (organization_id, user_id);

create unique index if not exists organizations_slug_uidx
  on public.organizations (slug);

create unique index if not exists organization_invitations_pending_email_uidx
  on public.organization_invitations (organization_id, lower(email))
  where status = 'pending';

create index if not exists organization_invitations_organization_status_idx
  on public.organization_invitations (organization_id, status, created_at desc);

create index if not exists organization_invitations_token_hash_idx
  on public.organization_invitations (token_hash);

alter table public.underwriting_tier_policy
  drop constraint if exists underwriting_tier_policy_tier_key;

drop index if exists public.underwriting_tier_policy_tier_key;

create unique index if not exists underwriting_tier_policy_organization_tier_uidx
  on public.underwriting_tier_policy (organization_id, tier);

alter table public.organization_invitations enable row level security;

drop policy if exists "organization_invitations_select_self" on public.organization_invitations;
create policy "organization_invitations_select_self"
on public.organization_invitations
for select
to authenticated
using (
  lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
);

commit;

-- Verification queries:
-- select organization_id, email, status, expires_at
-- from public.organization_invitations
-- order by created_at desc;
--
-- select *
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename in ('organization_invitations', 'organization_users', 'organizations')
-- order by tablename, indexname;
