begin;

-- Private-to-server tables. Browser sessions have no direct table/RPC grants.
create table public.ask865_call_settings (
 organization_id uuid primary key references public.organizations(id),
 enabled boolean not null default false,
 confidence_threshold numeric not null default 0.8 check(confidence_threshold between 0.5 and 1),
 grade_retention_days integer not null default 730 check(grade_retention_days between 1 and 3650),
 excluded_retention_days integer not null default 30 check(excluded_retention_days between 1 and 90),
 policy_version text,
 provider_account_id text,
 check(not enabled or (nullif(trim(policy_version),'') is not null and nullif(trim(provider_account_id),'') is not null))
);
insert into public.ask865_call_settings(organization_id)
 select organization_id from public.organization_modules where module_key='ask865' and enabled;

create table public.ask865_call_reviews (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.ask865_call_settings(organization_id),
 provider_call_id text not null check(length(provider_call_id) between 1 and 160),
 recording_id text, employee_id text,
 direction text not null check(direction in ('inbound','outbound')),
 started_at timestamptz not null,
 category text not null check(category in ('sales','service','mixed','vendor','payments','accounts_payable','collections','internal','personal','unknown')),
 score integer check(score between 0 and 100),
 ai_category text not null, ai_score integer check(ai_score between 0 and 100),
 evaluation jsonb not null check(jsonb_typeof(evaluation)='object'),
 scoring_allowed boolean not null,
 consent_reference text,
 policy_version text not null,
 analyzer_model text,
 status text not null check(status in ('not_required','needs_review','in_review','coaching_assigned','resolved')),
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 unique(organization_id,provider_call_id),
 unique(organization_id,id),
 check(score is null or (category in ('sales','service') and scoring_allowed)),
 check(ai_score is null or (ai_category in ('sales','service') and scoring_allowed))
);
create index ask865_call_inbox on public.ask865_call_reviews(organization_id,status,started_at desc);
create index ask865_call_expiry on public.ask865_call_reviews(expires_at);
create table public.ask865_call_audit (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 call_id uuid not null,
 actor_id uuid not null,
 reason text not null check(length(trim(reason)) between 5 and 1000),
 before_state jsonb not null, after_state jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(organization_id,call_id) references public.ask865_call_reviews(organization_id,id) on delete cascade
);
create index ask865_call_audit_history on public.ask865_call_audit(organization_id,call_id,created_at);
alter table public.ask865_call_settings enable row level security;
alter table public.ask865_call_reviews enable row level security;
alter table public.ask865_call_audit enable row level security;
revoke all on public.ask865_call_settings,public.ask865_call_reviews,public.ask865_call_audit from public,anon,authenticated,service_role;
grant select on public.ask865_call_settings to service_role;
grant select,insert,delete on public.ask865_call_reviews to service_role;
grant update(category,score,status) on public.ask865_call_reviews to service_role;
grant select,insert on public.ask865_call_audit to service_role;

-- Every correction must supply trusted server actor/reason context and gets an
-- atomic audit entry. AI result, identity, org and evidence cannot be overwritten.
create function public.ask865_audit_call_correction() returns trigger
language plpgsql security invoker set search_path='' as $$
declare actor uuid; reason text; days integer;
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
 new.expires_at := new.started_at + make_interval(days=>days);
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
revoke all on function public.ask865_audit_call_correction() from public,anon,authenticated;
create trigger ask865_call_correction_audit before update on public.ask865_call_reviews
 for each row execute function public.ask865_audit_call_correction();

create function public.atlas_ask865_correct_call(
 p_organization_id uuid,p_call_id uuid,p_actor_id uuid,p_expected_revision integer,
 p_category text,p_score integer,p_status text,p_reason text
) returns integer language plpgsql security invoker set search_path='' as $$
declare current_row public.ask865_call_reviews; new_revision integer;
begin
 if not exists(select 1 from public.organization_modules m join public.organizations o on o.id=m.organization_id
   where m.organization_id=p_organization_id and m.module_key='ask865' and m.enabled and o.is_active) then
   raise exception 'Module unavailable' using errcode='42501';
 end if;
 if p_status is null or p_status not in ('needs_review','in_review','coaching_assigned','resolved') or
   p_reason is null or length(trim(p_reason)) not between 5 and 1000 or p_actor_id is null then
   raise exception 'Invalid correction' using errcode='22023';
 end if;
 select * into current_row from public.ask865_call_reviews
   where organization_id=p_organization_id and id=p_call_id and expires_at>now() for update;
 if not found then raise exception 'Call not found' using errcode='P0002'; end if;
 if p_expected_revision is null or current_row.revision<>p_expected_revision then
   raise exception 'Review changed' using errcode='40001';
 end if;
 -- A category correction must not accidentally carry forward the old rubric's
 -- score. The UI clears it; any supplied score is an explicit manager override.
 perform set_config('ask865.call_actor',p_actor_id::text,true);
 perform set_config('ask865.call_reason',trim(p_reason),true);
 update public.ask865_call_reviews set category=p_category,score=p_score,status=p_status
   where organization_id=p_organization_id and id=p_call_id returning revision into new_revision;
 perform set_config('ask865.call_actor','',true);
 perform set_config('ask865.call_reason','',true);
 return new_revision;
end $$;
revoke all on function public.atlas_ask865_correct_call(uuid,uuid,uuid,integer,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.atlas_ask865_correct_call(uuid,uuid,uuid,integer,text,integer,text,text) to service_role;

-- Extend Atlas's existing permissions; no alternate authorization system.
alter table public.organization_role_permissions drop constraint organization_role_permissions_permission_key_check;
alter table public.organization_role_permissions add constraint organization_role_permissions_permission_key_check
 check(permission_key in ('view_deals','edit_deals','submit_deals','fund_deals','approve_overrides','manage_users','manage_underwriting_settings','manage_workflow_settings','view_audit_logs','manage_integrations','export_reports','view_ask865','review_ask865_sources','review_ask865_calls'));
alter table public.organization_user_permission_overrides drop constraint organization_user_permission_overrides_permission_key_check;
alter table public.organization_user_permission_overrides add constraint organization_user_permission_overrides_permission_key_check
 check(permission_key in ('view_deals','edit_deals','submit_deals','fund_deals','approve_overrides','manage_users','manage_underwriting_settings','manage_workflow_settings','view_audit_logs','manage_integrations','export_reports','view_ask865','review_ask865_sources','review_ask865_calls'));
insert into public.organization_role_permissions(organization_id,role,permission_key,allowed)
 select id,r.role,'review_ask865_calls',r.role in ('management','admin')
 from public.organizations cross join(values('sales'),('management'),('admin')) r(role)
 on conflict(organization_id,role,permission_key) do nothing;
commit;
