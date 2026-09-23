-- READ ONLY / TEST FIXTURE / NOT FOR AUTOMATIC EXECUTION.
-- Phase 1 Stage C reconciliation queries. Run only after the reviewed Phase 1
-- schema has been applied to a separately approved disposable database.
-- This file does not mutate data.

-- 1. Ledger integrity and duplicate business sources.
select transaction_id,
       sum(case when entry_side = 'DEBIT' then amount_cents else 0 end) as debit_cents,
       sum(case when entry_side = 'CREDIT' then amount_cents else 0 end) as credit_cents
from public.financial_ledger_entries
group by transaction_id
having sum(case when entry_side = 'DEBIT' then amount_cents else 0 end)
    <> sum(case when entry_side = 'CREDIT' then amount_cents else 0 end);

select transaction_type, source_type, source_id, count(*) as posting_count
from public.financial_transactions
where transaction_state = 'POSTED'
group by transaction_type, source_type, source_id
having count(*) > 1;

-- 2. Completed-trip commission snapshots versus proposed postings.
with legacy as (
  select id as trip_id,
         round(coalesce(commission_amount, 0) * 100)::bigint as legacy_cents
  from public.trips
  where status = 'completed'
), ledger as (
  select ft.source_id as trip_id,
         coalesce(sum(case when fle.entry_side = 'CREDIT' then fle.amount_cents else -fle.amount_cents end), 0)::bigint as ledger_cents
  from public.financial_transactions ft
  join public.financial_ledger_entries fle on fle.transaction_id = ft.id
  join public.financial_accounts fa on fa.id = fle.account_id
  where ft.transaction_state = 'POSTED'
    and ft.transaction_type = 'TRIP_FINANCIAL_COMPLETION'
    and ft.source_type = 'TRIP'
    and fa.account_category = 'COMMISSION_REVENUE'
  group by ft.source_id
)
select l.trip_id, l.legacy_cents, coalesce(g.ledger_cents, 0) as ledger_cents,
       l.legacy_cents - coalesce(g.ledger_cents, 0) as difference_cents
from legacy l left join ledger g using (trip_id)
where l.legacy_cents <> coalesce(g.ledger_cents, 0);

-- 3. Settlement receipts and unapplied overpayments.
select ds.id as settlement_id,
       round(coalesce(ds.amount_paid, 0) * 100)::bigint as legacy_receipt_cents,
       coalesce(sum(case when fle.entry_side = 'DEBIT' then fle.amount_cents else 0 end), 0)::bigint as ledger_receipt_cents
from public.driver_settlements ds
left join public.financial_transactions ft
  on ft.source_type = 'DRIVER_SETTLEMENT' and ft.source_id = ds.id and ft.transaction_state = 'POSTED'
left join public.financial_ledger_entries fle on fle.transaction_id = ft.id
left join public.financial_accounts fa on fa.id = fle.account_id and fa.account_category = 'PAYMENT_CLEARING'
group by ds.id, ds.amount_paid
having round(coalesce(ds.amount_paid, 0) * 100)::bigint
    <> coalesce(sum(case when fa.id is not null and fle.entry_side = 'DEBIT' then fle.amount_cents else 0 end), 0)::bigint;

-- 4. driver_subscription_payments contains approved receipts only. Pending
-- workflow remains in driver_payment_requests and must not post money.
select dsp.id as payment_id,
       round(coalesce(dsp.amount_paid, 0) * 100)::bigint as legacy_cents,
       count(ft.id) as ledger_transactions
from public.driver_subscription_payments dsp
left join public.financial_transactions ft
  on ft.source_type = 'DRIVER_SUBSCRIPTION_PAYMENT' and ft.source_id = dsp.id and ft.transaction_state = 'POSTED'
group by dsp.id, dsp.amount_paid
having count(ft.id) <> 1;

-- 5. Cancellation/no-show assessments. A fee row is not proof of collection.
select tcf.id as fee_id, tcf.trip_id,
       round(coalesce(tcf.fee_amount, 0) * 100)::bigint as assessed_cents,
       count(ft.id) filter (where ft.transaction_type in ('CANCELLATION_FEE','NO_SHOW_FEE')) as assessment_postings
from public.trip_cancellation_fees tcf
left join public.financial_transactions ft
  on ft.source_type = 'TRIP_CANCELLATION_FEE' and ft.source_id = tcf.id and ft.transaction_state = 'POSTED'
group by tcf.id, tcf.trip_id, tcf.fee_amount
having count(ft.id) filter (where ft.transaction_type in ('CANCELLATION_FEE','NO_SHOW_FEE')) > 1;

-- 6. Orphan detection. Every posted source must still resolve.
select ft.id, ft.source_type, ft.source_id
from public.financial_transactions ft
where ft.transaction_state = 'POSTED'
  and case ft.source_type
    when 'TRIP' then not exists(select 1 from public.trips s where s.id=ft.source_id)
    when 'DRIVER_SETTLEMENT' then not exists(select 1 from public.driver_settlements s where s.id=ft.source_id)
    when 'DRIVER_PAYMENT_REQUEST' then not exists(select 1 from public.driver_payment_requests s where s.id=ft.source_id)
    when 'DRIVER_SUBSCRIPTION_PAYMENT' then not exists(select 1 from public.driver_subscription_payments s where s.id=ft.source_id)
    when 'TRIP_CANCELLATION_FEE' then not exists(select 1 from public.trip_cancellation_fees s where s.id=ft.source_id)
    when 'FINANCIAL_TRANSACTION' then not exists(select 1 from public.financial_transactions s where s.id=ft.source_id)
    else false
  end;

-- Source precedence: trips own completion snapshots; driver_settlements own
-- collected settlement money; approved driver_subscription_payments own
-- subscription receipts; trip_cancellation_fees own assessments only.
-- driver_payment_requests and cached driver_wallets are never independent money
-- sources and must not be added to these totals.
