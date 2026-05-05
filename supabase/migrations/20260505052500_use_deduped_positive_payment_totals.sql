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
    coalesce(
      case when snapshot.monthly_payment_amount > 0 then snapshot.monthly_payment_amount end,
      case
        when public.dms_parse_numeric(snapshot.raw_data ->> 'Monthly Payment') > 0
        then public.dms_parse_numeric(snapshot.raw_data ->> 'Monthly Payment')
      end,
      case when snapshot.previous_payment_amount > 0 then snapshot.previous_payment_amount end,
      case
        when snapshot.total_payment_amount > 0 and snapshot.total_payment_amount <= 5000
        then snapshot.total_payment_amount
      end
    ) as scheduled_payment_amount,
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
ledger_events as (
  select distinct on (
    ledger.organization_id,
    ledger.deal_number,
    ledger.paid_date,
    ledger.paid_amount,
    lower(coalesce(ledger.transaction_type, '')),
    coalesce(ledger.period_num, ''),
    coalesce(ledger.ref_num, ''),
    ledger.last_updated_date
  )
    ledger.*
  from public.dms_payment_ledger ledger
  where ledger.deal_number is not null
  order by
    ledger.organization_id,
    ledger.deal_number,
    ledger.paid_date,
    ledger.paid_amount,
    lower(coalesce(ledger.transaction_type, '')),
    coalesce(ledger.period_num, ''),
    coalesce(ledger.ref_num, ''),
    ledger.last_updated_date,
    ledger.created_at desc,
    ledger.id desc
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
  from ledger_events ledger
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
      when snapshot.payment_frequency_days is null or snapshot.scheduled_payment_amount is null then null
      else floor(30::numeric / snapshot.payment_frequency_days) * snapshot.scheduled_payment_amount
    end as expected_paid_30d,
    case
      when snapshot.payment_frequency_days is null or snapshot.scheduled_payment_amount is null then null
      else floor(60::numeric / snapshot.payment_frequency_days) * snapshot.scheduled_payment_amount
    end as expected_paid_60d,
    case
      when snapshot.payment_frequency_days is null or snapshot.scheduled_payment_amount is null then null
      else floor(90::numeric / snapshot.payment_frequency_days) * snapshot.scheduled_payment_amount
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
    and snapshot.scheduled_payment_amount is not null
    and snapshot.scheduled_payment_amount > 0
    and (rollup.total_paid_60d / nullif(rollup.payments_60d, 0)) < (snapshot.scheduled_payment_amount * 0.5)
  ) as survival_payment_flag,
  snapshot.scheduled_payment_amount
from latest_snapshot snapshot
left join payment_rollups rollup
  on rollup.organization_id = snapshot.organization_id
 and rollup.deal_number = snapshot.deal_number
left join expected_payment expected
  on expected.organization_id = snapshot.organization_id
 and expected.deal_number = snapshot.deal_number;

comment on view public.account_payment_signals
  is 'Sanitized per-account payment performance signals built from latest account snapshots and deduped positive non-reversal ledger payments. Reversals are tracked separately.';

comment on column public.account_payment_signals.total_paid_60d
  is 'Deduped positive non-reversal payments in the last 60 days. Reversal/return events are counted separately and do not add to this total.';

commit;
