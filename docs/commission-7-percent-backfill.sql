-- MOOVU 7% commission backfill
-- Review-only migration. Do not run against production until approved.
--
-- Purpose:
-- - Update only completed trips to the current 7% MOOVU commission rate.
-- - Recalculate trip commission and driver net earnings.
-- - Update existing commission wallet transactions for those trips.
-- - Recalculate existing driver wallet totals and balances.
--
-- Safety:
-- - Does not touch requested, offered, assigned, arrived, ongoing, scheduled, cancelled, or any non-completed trips.
-- - Does not delete rows.
-- - Does not create new wallet transactions.
-- - Does not create missing driver wallets.

begin;

create temporary table moovu_commission_7_backfill as
select
  t.id as trip_id,
  t.driver_id,
  round(coalesce(t.fare_amount, 0)::numeric, 2) as fare_amount,
  7::numeric as new_commission_pct,
  round((coalesce(t.fare_amount, 0)::numeric * 0.07), 2) as new_commission_amount,
  round(
    coalesce(t.fare_amount, 0)::numeric
    - round((coalesce(t.fare_amount, 0)::numeric * 0.07), 2),
    2
  ) as new_driver_net_earnings
from public.trips t
where t.status = 'completed'
  and t.driver_id is not null
  and coalesce(t.fare_amount, 0) > 0
  and (
    coalesce(t.commission_pct::numeric, -1) <> 7
    or coalesce(round(t.commission_amount::numeric, 2), -1) <> round((coalesce(t.fare_amount, 0)::numeric * 0.07), 2)
    or coalesce(round(t.driver_net_earnings::numeric, 2), -1) <> round(
      coalesce(t.fare_amount, 0)::numeric
      - round((coalesce(t.fare_amount, 0)::numeric * 0.07), 2),
      2
    )
  );

-- Preview rows affected by the trip backfill.
select count(*) as trips_to_backfill
from moovu_commission_7_backfill;

update public.trips t
set
  commission_pct = b.new_commission_pct,
  commission_amount = b.new_commission_amount,
  driver_net_earnings = b.new_driver_net_earnings
from moovu_commission_7_backfill b
where t.id = b.trip_id
  and t.status = 'completed';

-- Update existing commission wallet transactions for affected completed trips.
-- This does not insert missing transactions; it only aligns existing commission debit rows.
update public.driver_wallet_transactions tx
set
  amount = b.new_commission_amount,
  direction = 'debit',
  description = '7% commission charged on trip ' || b.trip_id::text,
  meta = coalesce(tx.meta, '{}'::jsonb) || jsonb_build_object(
    'fare_amount', b.fare_amount,
    'commission_pct', b.new_commission_pct,
    'driver_net', b.new_driver_net_earnings,
    'backfilled_at', now()
  )
from moovu_commission_7_backfill b
where tx.trip_id = b.trip_id
  and tx.tx_type = 'commission';

-- Recalculate existing driver wallets from completed trips and approved/recorded settlements.
with completed_by_driver as (
  select
    t.driver_id,
    count(*)::integer as total_trips_completed,
    round(sum(coalesce(t.commission_amount, 0))::numeric, 2) as total_commission,
    round(sum(coalesce(t.driver_net_earnings, coalesce(t.fare_amount, 0) - coalesce(t.commission_amount, 0)))::numeric, 2) as total_driver_net
  from public.trips t
  where t.status = 'completed'
    and t.driver_id is not null
  group by t.driver_id
),
settled_by_driver as (
  select
    s.driver_id,
    round(sum(coalesce(s.amount_paid, 0))::numeric, 2) as total_paid,
    max(s.created_at) as last_payment_at,
    (array_agg(s.amount_paid order by s.created_at desc nulls last))[1] as last_payment_amount
  from public.driver_settlements s
  group by s.driver_id
),
wallet_values as (
  select
    c.driver_id,
    c.total_trips_completed,
    c.total_commission,
    c.total_driver_net,
    coalesce(s.total_paid, 0) as total_paid,
    greatest(c.total_commission - coalesce(s.total_paid, 0), 0) as balance_due,
    s.last_payment_at,
    s.last_payment_amount
  from completed_by_driver c
  left join settled_by_driver s on s.driver_id = c.driver_id
)
update public.driver_wallets w
set
  total_commission = v.total_commission,
  total_driver_net = v.total_driver_net,
  total_trips_completed = v.total_trips_completed,
  balance_due = v.balance_due,
  last_payment_at = v.last_payment_at,
  last_payment_amount = v.last_payment_amount,
  account_status = case when v.balance_due > 0 then 'due' else 'settled' end,
  updated_at = now()
from wallet_values v
where w.driver_id = v.driver_id;

-- Verification: should return zero after the update.
select
  count(*) as remaining_completed_trip_commission_mismatches
from public.trips t
where t.status = 'completed'
  and coalesce(t.fare_amount, 0) > 0
  and (
    coalesce(t.commission_pct::numeric, -1) <> 7
    or coalesce(round(t.commission_amount::numeric, 2), -1) <> round((coalesce(t.fare_amount, 0)::numeric * 0.07), 2)
    or coalesce(round(t.driver_net_earnings::numeric, 2), -1) <> round(
      coalesce(t.fare_amount, 0)::numeric
      - round((coalesce(t.fare_amount, 0)::numeric * 0.07), 2),
      2
    )
  );

-- Verification: wallet rows recalculated for drivers with completed trips.
select
  w.driver_id,
  w.total_commission,
  w.total_driver_net,
  w.total_trips_completed,
  w.balance_due,
  w.account_status
from public.driver_wallets w
where exists (
  select 1
  from public.trips t
  where t.driver_id = w.driver_id
    and t.status = 'completed'
)
order by w.updated_at desc nulls last;

commit;
