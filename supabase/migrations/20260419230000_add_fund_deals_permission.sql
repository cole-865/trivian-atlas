begin;

alter table public.organization_role_permissions
  drop constraint if exists organization_role_permissions_permission_key_check;

alter table public.organization_role_permissions
  add constraint organization_role_permissions_permission_key_check
  check (
    permission_key in (
      'view_deals',
      'edit_deals',
      'submit_deals',
      'fund_deals',
      'approve_overrides',
      'manage_users',
      'manage_underwriting_settings',
      'manage_workflow_settings',
      'view_audit_logs',
      'manage_integrations',
      'export_reports'
    )
  );

alter table public.organization_user_permission_overrides
  drop constraint if exists organization_user_permission_overrides_permission_key_check;

alter table public.organization_user_permission_overrides
  add constraint organization_user_permission_overrides_permission_key_check
  check (
    permission_key in (
      'view_deals',
      'edit_deals',
      'submit_deals',
      'fund_deals',
      'approve_overrides',
      'manage_users',
      'manage_underwriting_settings',
      'manage_workflow_settings',
      'view_audit_logs',
      'manage_integrations',
      'export_reports'
    )
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
    ('sales', 'fund_deals', false),
    ('management', 'fund_deals', true),
    ('admin', 'fund_deals', true)
) as role_permissions(role, permission_key, allowed)
on conflict (organization_id, role, permission_key) do update
set
  allowed = excluded.allowed,
  updated_at = timezone('utc', now());

commit;
