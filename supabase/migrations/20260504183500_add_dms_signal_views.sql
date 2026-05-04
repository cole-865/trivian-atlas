begin;

create or replace view public.account_payment_signals
with (security_invoker = true)
as
with latest_snapshot as (
  select distinct on (snapshot.organization_id, snapshot.deal_number)
    snapshot.organization_id,
    snapshot.deal_number,
    snapshot.snapshot_date as latest_snapshot_date,
    snapshot.payment_frequency,
    public.dms_payment_frequency_days(snapshot.payment_frequency) as payment_frequency_days,
    snapshot.total_payment_amount,
    snapshot.days_past_due,
    snapshot.total_past_due_amount
  from public.dms_accounts_snapshot snapshot
  order by
    snapshot.organization_id,
    snapshot.deal_number,
    snapshot.snapshot_date desc,
    snapshot.created_at desc,
    snapshot.id desc
),
classified_payments as (
  select
    ledger.organization_id,
    ledger.deal_number,
    ledger.paid_date,
    coalesce(ledger.paid_amount, 0) as paid_amount,
    (
      ledger.is_reversal
      or coalesce(ledger.is_ach_returned, false)
      or coalesce(ledger.is_auto_nsf, false)
      or coalesce(ledger.paid_amount, 0) < 0
      or lower(coalesce(ledger.transaction_type, '')) like any (
        array['%revers%', '%return%', '%nsf%', '%void%', '%chargeback%']
      )
    ) as is_reversal_payment,
    case
      when not (
        ledger.is_reversal
        or coalesce(ledger.is_ach_returned, false)
        or coalesce(ledger.is_auto_nsf, false)
        or coalesce(ledger.paid_amount, 0) < 0
        or lower(coalesce(ledger.transaction_type, '')) like any (
          array['%revers%', '%return%', '%nsf%', '%void%', '%chargeback%']
        )
      )
      then coalesce(ledger.positive_payment_amount, greatest(coalesce(ledger.paid_amount, 0), 0))
      else 0
    end as positive_amount,
    case
      when (
        ledger.is_reversal
        or coalesce(ledger.is_ach_returned, false)
        or coalesce(ledger.is_auto_nsf, false)
        or coalesce(ledger.paid_amount, 0) < 0
        or lower(coalesce(ledger.transaction_type, '')) like any (
          array['%revers%', '%return%', '%nsf%', '%void%', '%chargeback%']
        )
      )
      then coalesce(ledger.reversal_amount, abs(coalesce(ledger.paid_amount, 0)))
      else 0
    end as reversal_amount
  from public.dms_payment_ledger ledger
  where ledger.deal_number is not null
),
payment_rollups as (
  select
    payments.organization_id,
    payments.deal_number,
    count(*) filter (
      where payments.positive_amount > 0
        and payments.paid_date >= current_date - interval '30 days'
    ) as payments_30d,
    count(*) filter (
      where payments.positive_amount > 0
        and payments.paid_date >= current_date - interval '60 days'
    ) as payments_60d,
    count(*) filter (
      where payments.positive_amount > 0
        and payments.paid_date >= current_date - interval '90 days'
    ) as payments_90d,
    coalesce(sum(payments.positive_amount) filter (
      where payments.paid_date >= current_date - interval '30 days'
    ), 0) as total_paid_30d,
    coalesce(sum(payments.positive_amount) filter (
      where payments.paid_date >= current_date - interval '60 days'
    ), 0) as total_paid_60d,
    coalesce(sum(payments.positive_amount) filter (
      where payments.paid_date >= current_date - interval '90 days'
    ), 0) as total_paid_90d,
    count(*) filter (
      where payments.is_reversal_payment
        and payments.paid_date >= current_date - interval '30 days'
    ) as reversals_30d,
    count(*) filter (
      where payments.is_reversal_payment
        and payments.paid_date >= current_date - interval '60 days'
    ) as reversals_60d,
    count(*) filter (
      where payments.is_reversal_payment
        and payments.paid_date >= current_date - interval '90 days'
    ) as reversals_90d,
    coalesce(sum(payments.positive_amount), 0) as lifetime_paid_from_ledger,
    min(payments.paid_date) filter (where payments.positive_amount > 0) as first_ledger_payment,
    max(payments.paid_date) filter (where payments.positive_amount > 0) as last_positive_payment_date
  from classified_payments payments
  group by payments.organization_id, payments.deal_number
),
expected_payment as (
  select
    snapshot.organization_id,
    snapshot.deal_number,
    case
      when snapshot.payment_frequency_days is null or snapshot.total_payment_amount is null then null
      else floor(30::numeric / snapshot.payment_frequency_days) * snapshot.total_payment_amount
    end as expected_paid_30d,
    case
      when snapshot.payment_frequency_days is null or snapshot.total_payment_amount is null then null
      else floor(60::numeric / snapshot.payment_frequency_days) * snapshot.total_payment_amount
    end as expected_paid_60d,
    case
      when snapshot.payment_frequency_days is null or snapshot.total_payment_amount is null then null
      else floor(90::numeric / snapshot.payment_frequency_days) * snapshot.total_payment_amount
    end as expected_paid_90d
  from latest_snapshot snapshot
)
select
  snapshot.organization_id,
  snapshot.deal_number,
  snapshot.latest_snapshot_date,
  snapshot.payment_frequency,
  snapshot.total_payment_amount,
  snapshot.days_past_due,
  coalesce(rollup.payments_30d, 0) as payments_30d,
  coalesce(rollup.payments_60d, 0) as payments_60d,
  coalesce(rollup.payments_90d, 0) as payments_90d,
  coalesce(rollup.total_paid_30d, 0) as total_paid_30d,
  coalesce(rollup.total_paid_60d, 0) as total_paid_60d,
  coalesce(rollup.total_paid_90d, 0) as total_paid_90d,
  case
    when coalesce(rollup.payments_60d, 0) = 0 then null
    else rollup.total_paid_60d / rollup.payments_60d
  end as avg_payment_60d,
  coalesce(rollup.reversals_30d, 0) as reversals_30d,
  coalesce(rollup.reversals_60d, 0) as reversals_60d,
  coalesce(rollup.reversals_90d, 0) as reversals_90d,
  coalesce(rollup.lifetime_paid_from_ledger, 0) as lifetime_paid_from_ledger,
  rollup.first_ledger_payment,
  rollup.last_positive_payment_date,
  expected.expected_paid_30d,
  expected.expected_paid_60d,
  expected.expected_paid_90d,
  case
    when expected.expected_paid_30d is null or expected.expected_paid_30d = 0 then null
    else coalesce(rollup.total_paid_30d, 0) / expected.expected_paid_30d
  end as payment_ratio_30d,
  case
    when expected.expected_paid_60d is null or expected.expected_paid_60d = 0 then null
    else coalesce(rollup.total_paid_60d, 0) / expected.expected_paid_60d
  end as payment_ratio_60d,
  case
    when expected.expected_paid_90d is null or expected.expected_paid_90d = 0 then null
    else coalesce(rollup.total_paid_90d, 0) / expected.expected_paid_90d
  end as payment_ratio_90d,
  greatest(coalesce(expected.expected_paid_60d, 0) - coalesce(rollup.total_paid_60d, 0), 0) as catchup_gap_estimated,
  case
    when rollup.last_positive_payment_date is null then null
    else current_date - rollup.last_positive_payment_date
  end as days_since_last_payment,
  coalesce(rollup.payments_60d, 0) >= 5 as fragmented_payment_flag,
  (
    coalesce(rollup.payments_60d, 0) >= 3
    and snapshot.total_payment_amount is not null
    and snapshot.total_payment_amount > 0
    and (rollup.total_paid_60d / nullif(rollup.payments_60d, 0)) < (snapshot.total_payment_amount * 0.5)
  ) as survival_payment_flag
from latest_snapshot snapshot
left join payment_rollups rollup
  on rollup.organization_id = snapshot.organization_id
 and rollup.deal_number = snapshot.deal_number
left join expected_payment expected
  on expected.organization_id = snapshot.organization_id
 and expected.deal_number = snapshot.deal_number;

create or replace view public.account_collections_signals
with (security_invoker = true)
as
with classified_events as (
  select
    event.organization_id,
    event.deal_number,
    event.created_date,
    event.promise_amount,
    (
      event.has_promise
      or event.promise_amount is not null
      or event.promise_date is not null
      or nullif(btrim(coalesce(event.promised_result, '')), '') is not null
    ) as has_promise,
    (
      event.promise_kept
      or lower(coalesce(event.promised_result, '')) like any (array['%kept%', '%paid%', '%complete%', '%honor%'])
    ) as promise_kept,
    (
      event.promise_broken
      or lower(coalesce(event.promised_result, '')) like any (array['%broken%', '%miss%', '%failed%', '%not kept%'])
    ) as promise_broken,
    (
      event.is_outbound
      or lower(concat_ws(' ', event.activity_type, event.disposition, event.subject)) like any (
        array['%outbound%', '%called customer%', '%sms sent%', '%text sent%', '%email sent%']
      )
    ) as is_outbound,
    (
      event.is_inbound
      or lower(concat_ws(' ', event.activity_type, event.disposition, event.subject)) like any (
        array['%inbound%', '%incoming%', '%customer called%', '%reply%', '%responded%']
      )
    ) as is_inbound
  from public.dms_activity_events event
  where event.deal_number is not null
),
event_rollups as (
  select
    event.organization_id,
    event.deal_number,
    count(*) filter (where event.created_date >= current_date - interval '30 days') as contacts_30d,
    count(*) filter (where event.created_date >= current_date - interval '60 days') as contacts_60d,
    count(*) filter (where event.created_date >= current_date - interval '90 days') as contacts_90d,
    count(*) filter (
      where event.is_outbound
        and event.created_date >= current_date - interval '90 days'
    ) as outbound_90d,
    count(*) filter (
      where event.is_inbound
        and event.created_date >= current_date - interval '90 days'
    ) as inbound_90d,
    count(*) filter (
      where event.has_promise
        and event.created_date >= current_date - interval '90 days'
    ) as promises_90d,
    count(*) filter (where event.has_promise) as total_promises,
    coalesce(sum(event.promise_amount) filter (where event.has_promise), 0) as total_promise_amount,
    count(*) filter (where event.promise_kept) as total_promise_kept,
    count(*) filter (where event.promise_broken) as total_promise_broken,
    max(event.created_date)::date as last_activity_date
  from classified_events event
  group by event.organization_id, event.deal_number
),
scored as (
  select
    rollup.*,
    case
      when rollup.outbound_90d = 0 then null
      else rollup.inbound_90d::numeric / rollup.outbound_90d
    end as response_rate_90d,
    case
      when rollup.total_promises = 0 then null
      else rollup.total_promise_kept::numeric / rollup.total_promises
    end as promise_reliability_life,
    case
      when rollup.last_activity_date is null then null
      else current_date - rollup.last_activity_date
    end as days_since_last_activity
  from event_rollups rollup
),
score_components as (
  select
    scored.*,
    case
      when scored.contacts_30d >= 20 then 25
      when scored.contacts_30d >= 10 then 15
      when scored.contacts_30d >= 5 then 8
      else 0
    end as contact_volume_score,
    case
      when scored.outbound_90d >= 10 and coalesce(scored.response_rate_90d, 0) < 0.10 then 25
      when scored.outbound_90d >= 5 and coalesce(scored.response_rate_90d, 0) < 0.20 then 15
      else 0
    end as avoidance_score,
    case
      when scored.total_promises >= 3 and coalesce(scored.promise_reliability_life, 0) < 0.50 then 20
      else 0
    end
    + case when scored.total_promise_broken > 0 then 10 else 0 end as promise_score,
    case
      when scored.outbound_90d >= 8 and scored.inbound_90d = 0 and scored.total_promises = 0 then 15
      else 0
    end as no_engagement_score,
    case
      when scored.days_since_last_activity >= 30 then 5
      else 0
    end as stale_activity_score
  from scored
),
latest_deals as (
  select distinct organization_id, deal_number
  from public.dms_accounts_snapshot
)
select
  deals.organization_id,
  deals.deal_number,
  coalesce(score.contacts_30d, 0) as contacts_30d,
  coalesce(score.contacts_60d, 0) as contacts_60d,
  coalesce(score.contacts_90d, 0) as contacts_90d,
  coalesce(score.outbound_90d, 0) as outbound_90d,
  coalesce(score.inbound_90d, 0) as inbound_90d,
  score.response_rate_90d,
  coalesce(score.promises_90d, 0) as promises_90d,
  coalesce(score.total_promises, 0) as total_promises,
  coalesce(score.total_promise_amount, 0) as total_promise_amount,
  coalesce(score.total_promise_kept, 0) as total_promise_kept,
  coalesce(score.total_promise_broken, 0) as total_promise_broken,
  score.promise_reliability_life,
  score.days_since_last_activity,
  (
    coalesce(score.contact_volume_score, 0)
    + coalesce(score.avoidance_score, 0)
    + coalesce(score.promise_score, 0)
    + coalesce(score.no_engagement_score, 0)
    + coalesce(score.stale_activity_score, 0)
  ) as collections_effort_score,
  case
    when (
      coalesce(score.contact_volume_score, 0)
      + coalesce(score.avoidance_score, 0)
      + coalesce(score.promise_score, 0)
      + coalesce(score.no_engagement_score, 0)
      + coalesce(score.stale_activity_score, 0)
    ) >= 75 then 'HIGH EFFORT / PROBLEM'
    when (
      coalesce(score.contact_volume_score, 0)
      + coalesce(score.avoidance_score, 0)
      + coalesce(score.promise_score, 0)
      + coalesce(score.no_engagement_score, 0)
      + coalesce(score.stale_activity_score, 0)
    ) >= 50 then 'ELEVATED EFFORT'
    when (
      coalesce(score.contact_volume_score, 0)
      + coalesce(score.avoidance_score, 0)
      + coalesce(score.promise_score, 0)
      + coalesce(score.no_engagement_score, 0)
      + coalesce(score.stale_activity_score, 0)
    ) >= 25 then 'WATCH'
    else 'NORMAL'
  end as collections_tier,
  case
    when coalesce(score.outbound_90d, 0) >= 8
      and coalesce(score.inbound_90d, 0) = 0
      and coalesce(score.total_promises, 0) = 0
      then 'Ghost / Avoider'
    when coalesce(score.total_promises, 0) >= 3
      and coalesce(score.promise_reliability_life, 0) < 0.50
      then 'Talker / Promise Risk'
    when coalesce(score.inbound_90d, 0) > 0
      and coalesce(score.response_rate_90d, 0) >= 0.20
      then 'Engaged'
    when coalesce(score.contacts_30d, 0) >= 20
      then 'High Touch'
    else 'Low Touch / Normal'
  end as customer_behavior_type
from latest_deals deals
left join score_components score
  on score.organization_id = deals.organization_id
 and score.deal_number = deals.deal_number;

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
    snapshot.collector_name
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
  scored.collector_name
from scored;

create or replace view public.account_outcomes
with (security_invoker = true)
as
with latest_snapshot as (
  select distinct on (snapshot.organization_id, snapshot.deal_number)
    snapshot.organization_id,
    snapshot.deal_number,
    snapshot.snapshot_date as latest_snapshot_date,
    snapshot.account_status,
    snapshot.custom_account_status,
    snapshot.account_conditions,
    snapshot.deal_date,
    snapshot.account_closed_date,
    snapshot.charge_off_date,
    snapshot.repo_completed_date,
    snapshot.last_repo_date,
    snapshot.cured_date,
    snapshot.repo_status,
    snapshot.bad_debt_amount,
    snapshot.principal_bad_debt_amount,
    snapshot.recovery_amount,
    snapshot.repo_credit,
    snapshot.account_sell_date,
    snapshot.account_sale_received_amount,
    snapshot.buy_back_cost,
    snapshot.net_profit,
    snapshot.exposure
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
    lower(concat_ws(' ', snapshot.account_status, snapshot.custom_account_status, snapshot.account_conditions)) as status_text,
    payments.payment_ratio_60d,
    collections.collections_effort_score
  from latest_snapshot snapshot
  left join public.account_payment_signals payments
    on payments.organization_id = snapshot.organization_id
   and payments.deal_number = snapshot.deal_number
  left join public.account_collections_signals collections
    on collections.organization_id = snapshot.organization_id
   and collections.deal_number = snapshot.deal_number
),
classified as (
  select
    signals.*,
    case
      when signals.status_text like '%unwind%' then 'unwound'
      when signals.charge_off_date is not null or signals.status_text like '%charge%' then 'charge_off'
      when signals.account_closed_date is not null
        or signals.status_text like '%paid%'
        or signals.status_text like '%closed%'
        then 'closed_or_paid'
      when signals.status_text like '%sold%' then 'sold'
      when signals.status_text like '%active%' then 'active'
      else nullif(btrim(coalesce(signals.account_status, '')), '')
    end as account_status_normalized,
    (
      coalesce(signals.bad_debt_amount, 0)
      + coalesce(signals.principal_bad_debt_amount, 0)
      + coalesce(signals.buy_back_cost, 0)
      - coalesce(signals.recovery_amount, 0)
      - coalesce(signals.repo_credit, 0)
      - coalesce(signals.account_sale_received_amount, 0)
    ) as loss_severity,
    (
      coalesce(signals.net_profit, 0)
      + coalesce(signals.recovery_amount, 0)
      + coalesce(signals.repo_credit, 0)
      + coalesce(signals.account_sale_received_amount, 0)
      - coalesce(signals.bad_debt_amount, 0)
      - coalesce(signals.principal_bad_debt_amount, 0)
      - coalesce(signals.buy_back_cost, 0)
    ) as net_outcome_estimate
  from joined_signals signals
)
select
  classified.organization_id,
  classified.deal_number,
  case
    when classified.account_status_normalized = 'unwound' then 'EXCLUDED'
    when classified.account_status_normalized = 'charge_off' then 'BAD OUTCOME'
    when classified.repo_completed_date is not null and classified.loss_severity > 0 then 'BAD OUTCOME'
    when classified.last_repo_date is not null and classified.cured_date is not null then 'BAD OUTCOME'
    when coalesce(classified.collections_effort_score, 0) >= 50
      and coalesce(classified.payment_ratio_60d, 1) < 0.50
      then 'BAD OUTCOME'
    when classified.account_status_normalized = 'closed_or_paid' then 'GOOD / PERFORMING'
    when classified.account_status_normalized = 'sold' and classified.net_outcome_estimate > 0 then 'GOOD / PERFORMING'
    when classified.account_status_normalized = 'active'
      and (
        coalesce(classified.collections_effort_score, 0) >= 25
        or coalesce(classified.payment_ratio_60d, 1) < 0.90
      )
      then 'WATCH / NEUTRAL'
    when classified.account_status_normalized = 'sold' then 'WATCH / NEUTRAL'
    else 'GOOD / PERFORMING'
  end as outcome_bucket,
  classified.account_status_normalized,
  (
    classified.account_status_normalized = 'charge_off'
    or (classified.repo_completed_date is not null and classified.loss_severity > 0)
    or (classified.last_repo_date is not null and classified.cured_date is not null)
    or (
      coalesce(classified.collections_effort_score, 0) >= 50
      and coalesce(classified.payment_ratio_60d, 1) < 0.50
    )
  ) as is_bad_outcome,
  (
    classified.account_status_normalized <> 'unwound'
    and (
      classified.account_status_normalized = 'closed_or_paid'
      or (classified.account_status_normalized = 'sold' and classified.net_outcome_estimate > 0)
    )
  ) as is_good_outcome,
  classified.account_status_normalized = 'unwound' as is_excluded,
  classified.loss_severity,
  classified.net_outcome_estimate,
  case
    when classified.account_closed_date is null or classified.deal_date is null then null
    else classified.account_closed_date - classified.deal_date
  end as days_to_close,
  case
    when classified.charge_off_date is null or classified.deal_date is null then null
    else classified.charge_off_date - classified.deal_date
  end as days_to_charge_off,
  case
    when classified.repo_completed_date is null or classified.deal_date is null then null
    else classified.repo_completed_date - classified.deal_date
  end as days_to_repo,
  classified.bad_debt_amount,
  classified.recovery_amount,
  classified.repo_credit,
  classified.account_sale_received_amount,
  classified.buy_back_cost,
  classified.net_profit,
  classified.exposure
from classified;

comment on view public.account_payment_signals
  is 'Sanitized per-account payment performance signals built from latest account snapshots and positive non-reversal ledger payments.';
comment on view public.account_collections_signals
  is 'Sanitized per-account collections effort and customer behavior signals built from DMS activity events.';
comment on view public.account_repo_signals
  is 'Sanitized per-account repo-risk scoring view combining latest snapshot, payment, and collections signals.';
comment on view public.account_outcomes
  is 'Sanitized per-account outcome classification view for underwriting feedback-loop analysis.';

comment on column public.account_payment_signals.deal_number
  is 'Exact DMS deal identifier stored and joined as text.';
comment on column public.account_payment_signals.payment_ratio_60d
  is 'Positive non-reversal payments over expected scheduled payments in the last 60 days.';
comment on column public.account_collections_signals.collections_effort_score
  is 'Rules-based collections effort score from contact volume, avoidance, promise reliability, no engagement, and stale activity.';
comment on column public.account_repo_signals.risk_flags
  is 'Text labels for repo-risk score components triggered for this account.';
comment on column public.account_outcomes.is_excluded
  is 'True for accounts excluded from normal underwriting performance analysis, such as unwound accounts.';

commit;
