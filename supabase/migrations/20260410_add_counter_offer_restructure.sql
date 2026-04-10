create table if not exists public.deal_structure_inputs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null unique references public.deals(id) on delete cascade,
  vehicle_id uuid not null references public.trivian_inventory(id),
  option_label text not null,
  include_vsc boolean not null default false,
  include_gap boolean not null default false,
  term_months integer not null,
  cash_down numeric null,
  sale_price numeric not null default 0,
  tax_rate_main numeric not null default 0,
  tax_add_base numeric not null default 0,
  tax_add_rate numeric not null default 0,
  doc_fee numeric not null default 0,
  title_license numeric not null default 0,
  vsc_price numeric not null default 0,
  gap_price numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deal_structure_inputs_org_idx
  on public.deal_structure_inputs (organization_id, deal_id);

create table if not exists public.deal_override_counter_offers (
  id uuid primary key default gen_random_uuid(),
  deal_override_request_id uuid not null references public.deal_override_requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  version_number integer not null,
  counter_type text not null,
  review_note text not null,
  reviewed_by uuid null,
  reviewed_at timestamptz not null default now(),
  base_structure_fingerprint text not null,
  proposal_structure_fingerprint text not null,
  inputs_json jsonb not null,
  outputs_snapshot_json jsonb not null,
  status text not null default 'active',
  stale_reason text null,
  rejection_reason text null,
  accepted_at timestamptz null,
  accepted_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists deal_override_counter_offers_request_version_idx
  on public.deal_override_counter_offers (deal_override_request_id, version_number);

create index if not exists deal_override_counter_offers_lookup_idx
  on public.deal_override_counter_offers (organization_id, deal_id, deal_override_request_id, status, version_number desc);
