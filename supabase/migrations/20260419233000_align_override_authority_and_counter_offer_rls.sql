begin;

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
    false
  );
$$;

grant execute on function public.atlas_has_deal_override_authority(uuid) to authenticated;

alter table public.deal_override_counter_offers enable row level security;

drop policy if exists "deal_override_counter_offers_select_org_members"
on public.deal_override_counter_offers;
create policy "deal_override_counter_offers_select_org_members"
on public.deal_override_counter_offers
for select
to authenticated
using (
  public.atlas_is_active_organization_member(organization_id)
);

commit;
