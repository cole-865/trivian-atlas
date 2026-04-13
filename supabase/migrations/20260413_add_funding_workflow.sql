begin;

alter table public.app_notifications
  drop constraint if exists app_notifications_type_check;

alter table public.app_notifications
  add constraint app_notifications_type_check
  check (
    type in (
      'deal_funded',
      'deal_funding_rejected',
      'deal_funding_review',
      'deal_override_requested',
      'deal_override_approved',
      'deal_override_denied',
      'deal_override_countered',
      'deal_override_stale'
    )
  );

create table if not exists public.deal_funding_stip_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  doc_type text not null check (doc_type in ('proof_of_income', 'proof_of_residence', 'driver_license')),
  status text not null check (status in ('verified', 'rejected')),
  rejection_reason text null,
  verified_monthly_income numeric null,
  structure_fingerprint text not null,
  verified_by uuid null references auth.users(id) on delete set null,
  verified_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, deal_id, doc_type)
);

create index if not exists deal_funding_stip_verifications_deal_idx
  on public.deal_funding_stip_verifications (organization_id, deal_id);

alter table public.deal_funding_stip_verifications enable row level security;

drop policy if exists "deal_funding_stip_verifications_select_org_members"
on public.deal_funding_stip_verifications;
create policy "deal_funding_stip_verifications_select_org_members"
on public.deal_funding_stip_verifications
for select
to authenticated
using (
  public.atlas_is_active_organization_member(organization_id)
);

commit;
