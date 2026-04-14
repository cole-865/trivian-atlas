begin;

create table if not exists public.deal_override_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  blocker_code text not null check (blocker_code in ('LTV', 'PTI', 'AMOUNT_FINANCED', 'VEHICLE_PRICE')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'cancelled', 'stale')),
  requested_by uuid null references auth.users(id) on delete set null,
  requested_note text null,
  requested_at timestamptz not null default timezone('utc', now()),
  reviewed_by uuid null references auth.users(id) on delete set null,
  review_note text null,
  reviewed_at timestamptz null,
  vehicle_id uuid null,
  cash_down_snapshot numeric null,
  amount_financed_snapshot numeric null,
  monthly_payment_snapshot numeric null,
  term_months_snapshot integer null,
  ltv_snapshot numeric null,
  pti_snapshot numeric null,
  structure_fingerprint text not null,
  stale_reason text null,
  status_changed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists deal_override_requests_organization_deal_idx
  on public.deal_override_requests (organization_id, deal_id);

create index if not exists deal_override_requests_organization_status_idx
  on public.deal_override_requests (organization_id, status, created_at desc);

create unique index if not exists deal_override_requests_pending_fingerprint_uidx
  on public.deal_override_requests (organization_id, deal_id, blocker_code, structure_fingerprint)
  where status = 'pending';

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('deal_override_requested', 'deal_override_approved', 'deal_override_denied', 'deal_override_stale')),
  deal_id uuid null references public.deals(id) on delete cascade,
  override_request_id uuid null references public.deal_override_requests(id) on delete cascade,
  title text not null,
  body text not null,
  link_href text null,
  metadata_json jsonb null,
  read_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists app_notifications_organization_user_read_idx
  on public.app_notifications (organization_id, user_id, read_at, created_at desc);

drop function if exists public.atlas_is_active_organization_member(uuid);
create or replace function public.atlas_is_active_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id = target_organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
  );
$$;

drop function if exists public.atlas_has_deal_override_authority(uuid);
create or replace function public.atlas_has_deal_override_authority(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select user_override.allowed
      from public.organization_user_permission_overrides user_override
      where user_override.organization_id = target_organization_id
        and user_override.user_id = auth.uid()
        and user_override.permission_key = 'approve_overrides'
      limit 1
    ),
    (
      select role_permission.allowed
      from public.organization_users organization_user
      join public.organization_role_permissions role_permission
        on role_permission.organization_id = organization_user.organization_id
       and role_permission.role = organization_user.role
       and role_permission.permission_key = 'approve_overrides'
      where organization_user.organization_id = target_organization_id
        and organization_user.user_id = auth.uid()
        and organization_user.is_active = true
      limit 1
    ),
    (
      select organization_user.role in ('management', 'admin')
      from public.organization_users organization_user
      where organization_user.organization_id = target_organization_id
        and organization_user.user_id = auth.uid()
        and organization_user.is_active = true
      limit 1
    ),
    false
  );
$$;

grant execute on function public.atlas_is_active_organization_member(uuid) to authenticated;
grant execute on function public.atlas_has_deal_override_authority(uuid) to authenticated;

alter table public.deal_override_requests enable row level security;
alter table public.app_notifications enable row level security;

drop policy if exists "deal_override_requests_select_org_members" on public.deal_override_requests;
create policy "deal_override_requests_select_org_members"
on public.deal_override_requests
for select
to authenticated
using (
  public.atlas_is_active_organization_member(organization_id)
);

drop policy if exists "deal_override_requests_insert_org_members" on public.deal_override_requests;
create policy "deal_override_requests_insert_org_members"
on public.deal_override_requests
for insert
to authenticated
with check (
  public.atlas_is_active_organization_member(organization_id)
  and requested_by = auth.uid()
);

drop policy if exists "deal_override_requests_update_override_authority" on public.deal_override_requests;
create policy "deal_override_requests_update_override_authority"
on public.deal_override_requests
for update
to authenticated
using (
  public.atlas_has_deal_override_authority(organization_id)
)
with check (
  public.atlas_has_deal_override_authority(organization_id)
);

drop policy if exists "app_notifications_select_owner" on public.app_notifications;
create policy "app_notifications_select_owner"
on public.app_notifications
for select
to authenticated
using (
  user_id = auth.uid()
  and public.atlas_is_active_organization_member(organization_id)
);

drop policy if exists "app_notifications_update_owner" on public.app_notifications;
create policy "app_notifications_update_owner"
on public.app_notifications
for update
to authenticated
using (
  user_id = auth.uid()
  and public.atlas_is_active_organization_member(organization_id)
)
with check (
  user_id = auth.uid()
  and public.atlas_is_active_organization_member(organization_id)
);

commit;
