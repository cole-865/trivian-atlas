begin;

drop policy if exists "audit_log_all_authenticated" on public.audit_log;
drop policy if exists "deals_insert_anon_dev" on public.deals;
drop policy if exists "deal_people_insert_anon_dev" on public.deal_people;
drop policy if exists "income_profiles_insert_anon_dev" on public.income_profiles;

drop policy if exists "Admins can update all documents" on public.documents;
drop policy if exists "Admins can view all documents" on public.documents;
drop policy if exists "Users can insert own documents" on public.documents;
drop policy if exists "Users can view own documents" on public.documents;

revoke all on table public.audit_log from anon;
revoke all on table public.deals from anon;
revoke all on table public.deal_people from anon;
revoke all on table public.income_profiles from anon;
revoke all on table public.documents from anon;
revoke all on table public.vehicle_options from anon;
revoke all on table public.vehicle_selection from anon;
revoke all on table public.deal_management_notes from anon;
revoke all on table public.bhph_bureau_rules from anon;

revoke insert, update, delete, truncate, references, trigger
on table public.audit_log
from authenticated;

revoke insert, update, delete, truncate, references, trigger
on table public.documents
from authenticated;

revoke insert, update, delete, truncate, references, trigger
on table public.vehicle_options
from authenticated;

revoke insert, update, delete, truncate, references, trigger
on table public.vehicle_selection
from authenticated;

revoke insert, update, delete, truncate, references, trigger
on table public.deal_management_notes
from authenticated;

grant select on table public.audit_log to authenticated;
grant select on table public.documents to authenticated;
grant select on table public.vehicle_options to authenticated;
grant select on table public.vehicle_selection to authenticated;
grant select on table public.deal_management_notes to authenticated;

revoke execute on function public.create_deal_with_seed_data(text)
from public, anon, authenticated;

revoke execute on function public.create_deal_with_seed_data(text, uuid)
from public, anon;

grant execute on function public.create_deal_with_seed_data(text, uuid)
to authenticated;

commit;
