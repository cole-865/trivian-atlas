begin;
-- A durable recording manifest contains no audio, transcript, phone numbers or URLs.
-- It survives review expiry so a five-year archive cannot become an unindexed file.
create table public.ask865_recording_jobs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.ask865_call_settings(organization_id),
 provider_account_id text not null,
 provider_call_id text not null,
 job_data jsonb not null check(jsonb_typeof(job_data)='object' and
   job_data - array['recordingIds','direction','startedAt','durationSeconds','employeeId'] = '{}'::jsonb),
 state text not null default 'queued' check(state in ('queued','running','completed','failed')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 lease_token uuid, lease_until timestamptz,
 available_at timestamptz not null default now(),
 archive_file_id text, archive_md5 text, archive_bytes integer,
 recording_expires_at timestamptz,
 last_error text check(last_error ~ '^[a-z_]{1,100}$'),
 created_at timestamptz not null default now(),
 unique(organization_id,provider_account_id,provider_call_id),
 unique(organization_id,id),
 unique(archive_file_id),
 check((archive_md5 is null and archive_bytes is null and recording_expires_at is null) or
   (archive_file_id is not null and archive_md5 ~ '^[a-f0-9]{32}$' and archive_bytes between 1 and 24000000 and recording_expires_at is not null))
);
create index ask865_recording_queue on public.ask865_recording_jobs(organization_id,provider_account_id,state,available_at);
alter table public.ask865_recording_jobs enable row level security;
revoke all on public.ask865_recording_jobs from public,anon,authenticated,service_role;
grant select,insert on public.ask865_recording_jobs to service_role;
grant update(state,attempts,lease_token,lease_until,available_at,archive_file_id,archive_md5,archive_bytes,recording_expires_at,last_error) on public.ask865_recording_jobs to service_role;

create function public.atlas_ask865_claim_recording(p_organization_id uuid,p_provider_account_id text)
returns setof public.ask865_recording_jobs language plpgsql security invoker set search_path='' as $$
declare candidate uuid;
begin
 if not exists(select 1 from public.ask865_call_settings s join public.organizations o on o.id=s.organization_id
   join public.organization_modules m on m.organization_id=s.organization_id and m.module_key='ask865'
   where s.organization_id=p_organization_id and s.enabled and o.is_active and m.enabled and s.provider_account_id=p_provider_account_id) then
   raise exception 'Recording processing unavailable' using errcode='42501';
 end if;
 update public.ask865_recording_jobs set state='failed',last_error='retry_limit_reached',lease_token=null,lease_until=null
   where organization_id=p_organization_id and provider_account_id=p_provider_account_id and state='running' and lease_until<now() and attempts>=3;
 select id into candidate from public.ask865_recording_jobs
   where organization_id=p_organization_id and provider_account_id=p_provider_account_id and attempts<3 and available_at<=now()
     and (state='queued' or (state='running' and lease_until<now()))
   order by created_at,id for update skip locked limit 1;
 if candidate is null then return; end if;
 return query update public.ask865_recording_jobs
   set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '15 minutes',last_error=null
   where organization_id=p_organization_id and id=candidate returning *;
end $$;
revoke all on function public.atlas_ask865_claim_recording(uuid,text) from public,anon,authenticated;
grant execute on function public.atlas_ask865_claim_recording(uuid,text) to service_role;
create table public.ask865_recording_access (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.ask865_call_settings(organization_id),
 job_id uuid not null, actor_id uuid not null,
 accessed_at timestamptz not null default now(),
 foreign key(organization_id,job_id) references public.ask865_recording_jobs(organization_id,id)
);
create index ask865_recording_access_org on public.ask865_recording_access(organization_id,accessed_at);
alter table public.ask865_recording_access enable row level security;
revoke all on public.ask865_recording_access from public,anon,authenticated,service_role;
grant select,insert on public.ask865_recording_access to service_role;
commit;
