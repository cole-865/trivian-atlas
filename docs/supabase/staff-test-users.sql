-- Manual step first:
-- Create these users in Supabase Auth > Authentication > Users:
--   sales.test@865autos.com
--   management.test@865autos.com
--   admin.test@865autos.com
--   dev.test@865autos.com
--
-- Then run this SQL to upsert matching public.user_profiles rows.

with seed_staff(email, full_name, role) as (
  values
    ('sales.test@865autos.com', 'Sales Test', 'sales'),
    ('management.test@865autos.com', 'Management Test', 'management'),
    ('admin.test@865autos.com', 'Admin Test', 'admin'),
    ('dev.test@865autos.com', 'Dev Test', 'dev')
)
insert into public.user_profiles (
  id,
  email,
  full_name,
  role,
  is_active,
  created_at,
  updated_at
)
select
  auth_user.id,
  auth_user.email,
  seed_staff.full_name,
  seed_staff.role,
  true,
  timezone('utc', now()),
  timezone('utc', now())
from seed_staff
join auth.users as auth_user
  on lower(auth_user.email) = lower(seed_staff.email)
on conflict (id) do update
set
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role,
  is_active = true,
  updated_at = timezone('utc', now());

-- Optional verification query:
select
  up.id,
  up.email,
  up.full_name,
  up.role,
  up.is_active
from public.user_profiles up
where up.email in (
  'sales.test@865autos.com',
  'management.test@865autos.com',
  'admin.test@865autos.com',
  'dev.test@865autos.com'
)
order by up.email;
