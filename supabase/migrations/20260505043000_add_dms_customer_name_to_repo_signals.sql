begin;

alter table public.dms_accounts_snapshot
  add column if not exists customer_name text null;

comment on column public.dms_accounts_snapshot.customer_name
  is 'Normalized customer display name from the All Accounts signer name fields. PII: intended for management/admin portfolio operations views only.';

update public.dms_accounts_snapshot
set customer_name = nullif(
  btrim(
    concat_ws(
      ' ',
      nullif(btrim(coalesce(raw_data ->> 'Signer First Name', '')), ''),
      nullif(btrim(coalesce(raw_data ->> 'Signer Last Name', '')), '')
    )
  ),
  ''
)
where customer_name is null
  and raw_data is not null;

create or replace view public.account_repo_signals
with (security_invoker = true)
as
with latest_snapshot as (
  select distinct on (snapshot.organization_id, snapshot.deal_number)
    snapshot.organization_id,
    snapshot.deal_number,
    snapshot.snapshot_date as latest_snapshot_date,
    snapshot.account_status,
    snapshot.payment_status,
    snapshot.days_past_due,
    snapshot.total_past_due_amount,
    snapshot.total_payment_due_amount,
    snapshot.total_payment_amount,
    snapshot.deal_date,
    snapshot.last_paid_date,
    snapshot.promise_date,
    snapshot.promised_result,
    snapshot.collateral_status,
    snapshot.repo_status,
    snapshot.repo_stage,
    snapshot.repo_type,
    snapshot.repo_reason,
    snapshot.out_for_repo_date,
    snapshot.repo_created_date,
    snapshot.repo_completed_date,
    snapshot.last_repo_date,
    snapshot.cured_date,
    snapshot.insurance_status,
    snapshot.current_insurance_expiry_date,
    snapshot.vehicle_year_make_model,
    snapshot.vehicle_vin,
    snapshot.vin_last_six,
    snapshot.vehicle_stock_number,
    snapshot.balance_principal_amount,
    snapshot.total_payoff_amount,
    snapshot.exposure,
    snapshot.collector_name,
    snapshot.customer_name
  from public.dms_accounts_snapshot snapshot
  order by
    snapshot.organization_id,
    snapshot.deal_number,
    snapshot.snapshot_date desc,
    snapshot.created_at desc,
    snapshot.id desc
),
joined_signals as (
  select
    snapshot.*,
    payments.payments_60d,
    payments.avg_payment_60d,
    payments.reversals_60d,
    payments.payment_ratio_60d,
    payments.days_since_last_payment,
    payments.fragmented_payment_flag,
    payments.survival_payment_flag,
    collections.total_promise_broken
  from latest_snapshot snapshot
  left join public.account_payment_signals payments
    on payments.organization_id = snapshot.organization_id
   and payments.deal_number = snapshot.deal_number
  left join public.account_collections_signals collections
    on collections.organization_id = snapshot.organization_id
   and collections.deal_number = snapshot.deal_number
),
score_components as (
  select
    signals.*,
    case
      when coalesce(signals.days_past_due, 0) >= 45 then 35
      when coalesce(signals.days_past_due, 0) >= 30 then 30
      when coalesce(signals.days_past_due, 0) >= 15 then 15
      when coalesce(signals.days_past_due, 0) >= 7 then 5
      else 0
    end as dpd_score,
    case
      when signals.payment_ratio_60d is null then 0
      when signals.payment_ratio_60d < 0.50 then 25
      when signals.payment_ratio_60d < 0.70 then 18
      when signals.payment_ratio_60d < 0.90 then 8
      else 0
    end as payment_ratio_score,
    case
      when coalesce(signals.payments_60d, 0) >= 8 then 12
      when coalesce(signals.payments_60d, 0) >= 5 then 7
      else 0
    end as fragmentation_score,
    case when signals.survival_payment_flag then 10 else 0 end as survival_score,
    case
      when coalesce(signals.reversals_60d, 0) >= 2 then 25
      when coalesce(signals.reversals_60d, 0) = 1 then 10
      else 0
    end as reversal_score,
    case
      when signals.promise_date is not null
        and signals.promise_date < current_date
        and coalesce(signals.days_past_due, 0) > 0
      then 8
      else 0
    end as promise_score,
    case
      when signals.deal_date is not null
        and current_date - signals.deal_date <= 120
        and coalesce(signals.days_past_due, 0) >= 15
      then 10
      else 0
    end as early_default_score,
    case
      when signals.days_since_last_payment >= 21 then 10
      when signals.days_since_last_payment >= 14 then 5
      else 0
    end as last_payment_score,
    case
      when signals.current_insurance_expiry_date is not null
        and signals.current_insurance_expiry_date < current_date
      then 7
      when lower(coalesce(signals.insurance_status, '')) like any (
        array['%expired%', '%cancel%', '%lapse%', '%inactive%']
      )
      then 7
      else 0
    end as collateral_score,
    case
      when nullif(btrim(coalesce(signals.repo_status, '')), '') is not null
        or nullif(btrim(coalesce(signals.repo_stage, '')), '') is not null
        or nullif(btrim(coalesce(signals.repo_type, '')), '') is not null
        or signals.out_for_repo_date is not null
        or signals.repo_created_date is not null
        or signals.repo_completed_date is not null
        or signals.last_repo_date is not null
      then 15
      else 0
    end as repo_activity_score
  from joined_signals signals
),
scored as (
  select
    components.*,
    least(
      100,
      components.dpd_score
      + components.payment_ratio_score
      + components.fragmentation_score
      + components.survival_score
      + components.reversal_score
      + components.promise_score
      + components.early_default_score
      + components.last_payment_score
      + components.collateral_score
      + components.repo_activity_score
    ) as repo_score
  from score_components components
)
select
  scored.organization_id,
  scored.deal_number,
  scored.repo_score,
  case
    when scored.repo_score >= 80 then 'REPO NOW'
    when scored.repo_score >= 60 then 'PRE-REPO'
    when scored.repo_score >= 35 then 'WATCH'
    else 'STABLE'
  end as recommended_status,
  array_remove(array[
    case when scored.dpd_score > 0 then 'days_past_due' end,
    case when scored.payment_ratio_score > 0 then 'low_60_day_payment_ratio' end,
    case when scored.fragmentation_score > 0 then 'fragmented_payments' end,
    case when scored.survival_score > 0 then 'survival_payments' end,
    case when scored.reversal_score > 0 then 'recent_reversals' end,
    case when scored.promise_score > 0 then 'past_due_broken_or_stale_promise' end,
    case when scored.early_default_score > 0 then 'early_default' end,
    case when scored.last_payment_score > 0 then 'stale_payment' end,
    case when scored.collateral_score > 0 then 'insurance_or_collateral_issue' end,
    case when scored.repo_activity_score > 0 then 'repo_activity_present' end
  ], null) as risk_flags,
  scored.repo_score >= 80 as repo_now,
  scored.repo_score between 60 and 79 as pre_repo,
  scored.repo_score between 35 and 59 as watch,
  scored.latest_snapshot_date,
  scored.account_status,
  scored.payment_status,
  scored.days_past_due,
  scored.total_past_due_amount,
  scored.total_payment_due_amount,
  scored.total_payment_amount,
  scored.payment_ratio_60d,
  scored.payments_60d,
  scored.reversals_60d,
  scored.days_since_last_payment,
  scored.promise_date,
  scored.promised_result,
  scored.collateral_status,
  scored.repo_status,
  scored.repo_stage,
  scored.repo_type,
  scored.repo_reason,
  scored.insurance_status,
  scored.current_insurance_expiry_date,
  scored.vehicle_year_make_model,
  scored.vehicle_vin,
  scored.vin_last_six,
  scored.vehicle_stock_number,
  scored.balance_principal_amount,
  scored.total_payoff_amount,
  scored.exposure,
  scored.collector_name,
  scored.customer_name
from scored;

comment on view public.account_repo_signals
  is 'Sanitized per-account repo-risk scoring view combining latest snapshot, payment, and collections signals.';

comment on column public.account_repo_signals.customer_name
  is 'Customer display name normalized from the latest All Accounts snapshot signer name fields. PII: use only in authorized portfolio operations UI.';

commit;
