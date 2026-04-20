begin;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select pol.polname
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = 'deal_documents'
  loop
    execute format('drop policy if exists %I on public.deal_documents', policy_name);
  end loop;
end
$$;

create policy "deal_documents_select_active_members"
on public.deal_documents
for select
to authenticated
using (
  organization_id is not null
  and public.atlas_is_active_organization_member(organization_id)
);

create policy "deal_documents_insert_active_members"
on public.deal_documents
for insert
to authenticated
with check (
  organization_id is not null
  and public.atlas_is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = deal_documents.organization_id
  )
  and (
    doc_type <> 'credit_bureau'
    or applicant_role in ('primary', 'co')
  )
);

create policy "deal_documents_update_active_members"
on public.deal_documents
for update
to authenticated
using (
  organization_id is not null
  and public.atlas_is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.atlas_is_active_organization_member(organization_id)
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = deal_documents.organization_id
  )
  and (
    doc_type <> 'credit_bureau'
    or applicant_role in ('primary', 'co')
  )
);

create policy "deal_documents_delete_active_members"
on public.deal_documents
for delete
to authenticated
using (
  organization_id is not null
  and public.atlas_is_active_organization_member(organization_id)
);

drop policy if exists "credit_report_jobs_insert_active_members" on public.credit_report_jobs;
create policy "credit_report_jobs_insert_active_members"
on public.credit_report_jobs
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and applicant_role in ('primary', 'co')
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = credit_report_jobs.organization_id
  )
);

drop policy if exists "credit_report_jobs_update_active_members" on public.credit_report_jobs;
create policy "credit_report_jobs_update_active_members"
on public.credit_report_jobs
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and applicant_role in ('primary', 'co')
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = credit_report_jobs.organization_id
  )
);

drop policy if exists "credit_reports_insert_active_members" on public.credit_reports;
create policy "credit_reports_insert_active_members"
on public.credit_reports
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and applicant_role in ('primary', 'co')
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = credit_reports.organization_id
  )
  and (
    latest_job_id is null
    or exists (
      select 1
      from public.credit_report_jobs crj
      where crj.id = latest_job_id
        and crj.deal_id = credit_reports.deal_id
        and crj.organization_id = credit_reports.organization_id
        and crj.applicant_role = credit_reports.applicant_role
    )
  )
);

drop policy if exists "credit_reports_update_active_members" on public.credit_reports;
create policy "credit_reports_update_active_members"
on public.credit_reports
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and applicant_role in ('primary', 'co')
  and exists (
    select 1
    from public.deals d
    where d.id = deal_id
      and d.organization_id = credit_reports.organization_id
  )
  and (
    latest_job_id is null
    or exists (
      select 1
      from public.credit_report_jobs crj
      where crj.id = latest_job_id
        and crj.deal_id = credit_reports.deal_id
        and crj.organization_id = credit_reports.organization_id
        and crj.applicant_role = credit_reports.applicant_role
    )
  )
);

drop policy if exists "bureau_summary_insert_active_members" on public.bureau_summary;
create policy "bureau_summary_insert_active_members"
on public.bureau_summary
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and applicant_role in ('primary', 'co')
  and exists (
    select 1
    from public.credit_reports cr
    where cr.id = credit_report_id
      and cr.deal_id = bureau_summary.deal_id
      and cr.organization_id = bureau_summary.organization_id
      and cr.applicant_role = bureau_summary.applicant_role
  )
  and (
    job_id is null
    or exists (
      select 1
      from public.credit_report_jobs crj
      where crj.id = job_id
        and crj.deal_id = bureau_summary.deal_id
        and crj.organization_id = bureau_summary.organization_id
        and crj.applicant_role = bureau_summary.applicant_role
    )
  )
);

drop policy if exists "bureau_summary_update_active_members" on public.bureau_summary;
create policy "bureau_summary_update_active_members"
on public.bureau_summary
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and applicant_role in ('primary', 'co')
  and exists (
    select 1
    from public.credit_reports cr
    where cr.id = credit_report_id
      and cr.deal_id = bureau_summary.deal_id
      and cr.organization_id = bureau_summary.organization_id
      and cr.applicant_role = bureau_summary.applicant_role
  )
  and (
    job_id is null
    or exists (
      select 1
      from public.credit_report_jobs crj
      where crj.id = job_id
        and crj.deal_id = bureau_summary.deal_id
        and crj.organization_id = bureau_summary.organization_id
        and crj.applicant_role = bureau_summary.applicant_role
    )
  )
);

drop policy if exists "bureau_tradelines_insert_active_members" on public.bureau_tradelines;
create policy "bureau_tradelines_insert_active_members"
on public.bureau_tradelines
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and applicant_role in ('primary', 'co')
  and exists (
    select 1
    from public.bureau_summary bs
    where bs.id = bureau_summary_id
      and bs.deal_id = bureau_tradelines.deal_id
      and bs.organization_id = bureau_tradelines.organization_id
      and bs.applicant_role = bureau_tradelines.applicant_role
  )
);

drop policy if exists "bureau_tradelines_update_active_members" on public.bureau_tradelines;
create policy "bureau_tradelines_update_active_members"
on public.bureau_tradelines
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and applicant_role in ('primary', 'co')
  and exists (
    select 1
    from public.bureau_summary bs
    where bs.id = bureau_summary_id
      and bs.deal_id = bureau_tradelines.deal_id
      and bs.organization_id = bureau_tradelines.organization_id
      and bs.applicant_role = bureau_tradelines.applicant_role
  )
);

drop policy if exists "bureau_messages_insert_active_members" on public.bureau_messages;
create policy "bureau_messages_insert_active_members"
on public.bureau_messages
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and applicant_role in ('primary', 'co')
  and exists (
    select 1
    from public.bureau_summary bs
    where bs.id = bureau_summary_id
      and bs.deal_id = bureau_messages.deal_id
      and bs.organization_id = bureau_messages.organization_id
      and bs.applicant_role = bureau_messages.applicant_role
  )
);

drop policy if exists "bureau_messages_update_active_members" on public.bureau_messages;
create policy "bureau_messages_update_active_members"
on public.bureau_messages
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and applicant_role in ('primary', 'co')
  and exists (
    select 1
    from public.bureau_summary bs
    where bs.id = bureau_summary_id
      and bs.deal_id = bureau_messages.deal_id
      and bs.organization_id = bureau_messages.organization_id
      and bs.applicant_role = bureau_messages.applicant_role
  )
);

drop policy if exists "bureau_public_records_insert_active_members" on public.bureau_public_records;
create policy "bureau_public_records_insert_active_members"
on public.bureau_public_records
for insert
to authenticated
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and applicant_role in ('primary', 'co')
  and exists (
    select 1
    from public.bureau_summary bs
    where bs.id = bureau_summary_id
      and bs.deal_id = bureau_public_records.deal_id
      and bs.organization_id = bureau_public_records.organization_id
      and bs.applicant_role = bureau_public_records.applicant_role
  )
);

drop policy if exists "bureau_public_records_update_active_members" on public.bureau_public_records;
create policy "bureau_public_records_update_active_members"
on public.bureau_public_records
for update
to authenticated
using (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
)
with check (
  organization_id is not null
  and public.is_active_organization_member(organization_id)
  and applicant_role in ('primary', 'co')
  and exists (
    select 1
    from public.bureau_summary bs
    where bs.id = bureau_summary_id
      and bs.deal_id = bureau_public_records.deal_id
      and bs.organization_id = bureau_public_records.organization_id
      and bs.applicant_role = bureau_public_records.applicant_role
  )
);

commit;
