-- Override authority now resolves through organization_role_permissions plus
-- organization_user_permission_overrides. The previous column was backfilled
-- into approve_overrides in 20260413222111_add_dealership_settings.sql.
alter table public.organization_users
  drop column if exists can_approve_deal_overrides;
