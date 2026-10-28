begin;
alter table public.ask865_call_settings add column grade_retention_years integer check(grade_retention_years between 1 and 10);
alter table public.ask865_call_settings add column scheduler_enabled boolean not null default false;
-- Owner approved five calendar years for retained records, matching eligible audio.
update public.ask865_call_settings set grade_retention_years=5
where organization_id='9965d504-44a3-4d65-b210-f3f46fc558d1';
create function public.ask865_set_call_expiry() returns trigger language plpgsql security invoker set search_path='' as $$
declare s public.ask865_call_settings;
begin
 select * into strict s from public.ask865_call_settings where organization_id=new.organization_id;
 new.expires_at := case when new.category in ('vendor','payments','accounts_payable','collections','internal','personal') then new.started_at + make_interval(days=>s.excluded_retention_days)
 when s.grade_retention_years is not null then new.started_at + make_interval(years=>s.grade_retention_years)
 else new.started_at + make_interval(days=>s.grade_retention_days) end;
 return new;
end $$;
revoke all on function public.ask865_set_call_expiry() from public,anon,authenticated;
create trigger ask865_call_initial_expiry before insert on public.ask865_call_reviews for each row execute function public.ask865_set_call_expiry();
create or replace function public.ask865_audit_call_correction() returns trigger
language plpgsql security invoker set search_path='' as $$
declare actor uuid; reason text; days integer; years integer;
begin
 actor := nullif(current_setting('ask865.call_actor',true),'')::uuid;
 reason := current_setting('ask865.call_reason',true);
 if actor is null or reason is null or length(trim(reason)) not between 5 and 1000 then
   raise exception 'Audit context required' using errcode='42501';
 end if;
 new.revision := old.revision + 1;
 select case when new.category in ('vendor','payments','accounts_payable','collections','internal','personal')
   then excluded_retention_days else grade_retention_days end into days
 from public.ask865_call_settings where organization_id=new.organization_id;
 select grade_retention_years into years from public.ask865_call_settings where organization_id=new.organization_id;
 new.expires_at := case when years is not null and new.category not in ('vendor','payments','accounts_payable','collections','internal','personal')
 then new.started_at + make_interval(years=>years) else new.started_at + make_interval(days=>days) end;
 if new.category in ('vendor','payments','accounts_payable','collections','internal','personal') then
   new.recording_id := null;
   new.evaluation := jsonb_set(new.evaluation,'{assessment}','null'::jsonb);
 end if;
 insert into public.ask865_call_audit(organization_id,call_id,actor_id,reason,before_state,after_state)
 values(new.organization_id,new.id,actor,reason,
   jsonb_build_object('category',old.category,'score',old.score,'status',old.status,'revision',old.revision),
   jsonb_build_object('category',new.category,'score',new.score,'status',new.status,'revision',new.revision));
 return new;
end $$;

create table public.ask865_discovery_state(
 organization_id uuid not null references public.ask865_call_settings(organization_id),
 provider_account_id text not null,
 cursor_at timestamptz not null,
 lease_token uuid, lease_until timestamptz,
 last_success_at timestamptz,
 last_error text check(last_error ~ '^[a-z_]{1,100}$'),
 primary key(organization_id,provider_account_id)
);
alter table public.ask865_discovery_state enable row level security;
revoke all on public.ask865_discovery_state from public,anon,authenticated,service_role;
grant select,insert,update on public.ask865_discovery_state to service_role;
create function public.atlas_ask865_claim_discovery(p_org uuid,p_account text,p_start timestamptz)
returns setof public.ask865_discovery_state language plpgsql security invoker set search_path='' as $$
begin
 if p_start is null or p_start>now() or not exists(select 1 from public.ask865_call_settings s
 join public.organizations o on o.id=s.organization_id join public.organization_modules m on m.organization_id=s.organization_id and m.module_key='ask865'
 where s.organization_id=p_org and s.provider_account_id=p_account and s.enabled and s.scheduler_enabled and o.is_active and m.enabled) then
 raise exception 'Discovery disabled' using errcode='42501'; end if;
 insert into public.ask865_discovery_state(organization_id,provider_account_id,cursor_at) values(p_org,p_account,p_start) on conflict do nothing;
 return query update public.ask865_discovery_state set lease_token=gen_random_uuid(),lease_until=now()+interval '15 minutes'
 where organization_id=p_org and provider_account_id=p_account and (lease_until is null or lease_until<now()) returning *;
end $$;
create function public.atlas_ask865_finish_discovery(p_org uuid,p_account text,p_token uuid,p_cursor timestamptz,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 if p_error is not null and p_error !~ '^[a-z_]{1,100}$' then raise exception 'Invalid error' using errcode='22023';end if;
 update public.ask865_discovery_state set cursor_at=case when p_error is null then p_cursor else cursor_at end,
 last_success_at=case when p_error is null then now() else last_success_at end,last_error=p_error,lease_token=null,lease_until=null
 where organization_id=p_org and provider_account_id=p_account and lease_token=p_token and lease_until>now()
 and p_cursor>=cursor_at and p_cursor<=now();
 get diagnostics affected=row_count;return affected=1;
end $$;
revoke all on function public.atlas_ask865_claim_discovery(uuid,text,timestamptz),public.atlas_ask865_finish_discovery(uuid,text,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.atlas_ask865_claim_discovery(uuid,text,timestamptz),public.atlas_ask865_finish_discovery(uuid,text,uuid,timestamptz,text) to service_role;
commit;
