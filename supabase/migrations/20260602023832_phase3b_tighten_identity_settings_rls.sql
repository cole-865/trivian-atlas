begin;

revoke all on table public.app_settings from anon;
revoke all on table public.trivian_config from anon;
revoke all on table public.organizations from anon;
revoke all on table public.profiles from anon;
revoke all on table public.user_profiles from anon;

revoke insert, update, delete, truncate, references, trigger
on table public.app_settings
from authenticated;

revoke insert, update, delete, truncate, references, trigger
on table public.trivian_config
from authenticated;

revoke insert, update, delete, truncate, references, trigger
on table public.organizations
from authenticated;

revoke insert, update, delete, truncate, references, trigger
on table public.profiles
from authenticated;

revoke insert, update, delete, truncate, references, trigger
on table public.user_profiles
from authenticated;

grant select on table public.app_settings to authenticated;
grant select on table public.trivian_config to authenticated;
grant select on table public.organizations to authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.user_profiles to authenticated;

drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Users can read own profile" on public.profiles;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "admin and dev can insert user profiles" on public.user_profiles;
drop policy if exists "admin and dev can read all user profiles" on public.user_profiles;
drop policy if exists "admin and dev can update user profiles" on public.user_profiles;
drop policy if exists "users can read own user profile" on public.user_profiles;

create policy "user_profiles_select_own"
on public.user_profiles
for select
to authenticated
using (id = auth.uid());

create policy "user_profiles_select_platform_dev"
on public.user_profiles
for select
to authenticated
using ((select public.current_app_role()) = 'dev');

drop policy if exists "trivian_config_insert_active_members" on public.trivian_config;
drop policy if exists "trivian_config_update_active_members" on public.trivian_config;
drop policy if exists "trivian_config_delete_active_members" on public.trivian_config;

commit;
