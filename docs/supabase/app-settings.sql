create table if not exists public.app_settings (
  key text primary key,
  value_json jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.app_settings enable row level security;

create policy "authenticated users can read app settings"
on public.app_settings
for select
to authenticated
using (true);

create policy "admin and dev can insert app settings"
on public.app_settings
for insert
to authenticated
with check (
  coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role'
  ) in ('admin', 'dev')
);

create policy "admin and dev can update app settings"
on public.app_settings
for update
to authenticated
using (
  coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role'
  ) in ('admin', 'dev')
)
with check (
  coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role'
  ) in ('admin', 'dev')
);
