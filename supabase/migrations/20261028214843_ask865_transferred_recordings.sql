begin;
-- Provider timing only; no audio, transcript, phone numbers, or external URLs.
alter table public.ask865_recording_jobs
 add column recording_parts jsonb check(recording_parts is null or (jsonb_typeof(recording_parts)='array' and jsonb_array_length(recording_parts) between 1 and 4)),
 add column part_archives jsonb not null default '[]'::jsonb check(jsonb_typeof(part_archives)='array' and jsonb_array_length(part_archives)<=4);
-- Manifest is immutable to the worker. Only archive checkpoints can be updated,
-- guarded in application code by organization/account/job/lease predicates.
grant update(part_archives) on public.ask865_recording_jobs to service_role;
comment on column public.ask865_recording_jobs.part_archives is 'Private per-recording archive IDs, checksums and expiry; retained for cleanup even after the review expires.';
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
   new.evaluation := jsonb_set(new.evaluation - 'provisionalScore','{assessment}','null'::jsonb);
 end if;
 insert into public.ask865_call_audit(organization_id,call_id,actor_id,reason,before_state,after_state)
 values(new.organization_id,new.id,actor,reason,
   jsonb_build_object('category',old.category,'score',old.score,'status',old.status,'revision',old.revision),
   jsonb_build_object('category',new.category,'score',new.score,'status',new.status,'revision',new.revision));
 return new;
end $$;
commit;
