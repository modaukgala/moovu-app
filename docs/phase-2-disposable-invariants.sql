-- Read-only, full-table invariant queries for verified disposable tangtlmdpnvmoviwrgvd.
-- ADJUSTMENT source IDs are external evidence identities under the Phase 1 contract;
-- their supporting documents cannot be established by a database foreign-key query.
with checks as (
select 'unbalanced_transactions' as check_name,count(*)::bigint as violations from (
  select t.id from public.financial_transactions t left join public.financial_ledger_entries e on e.transaction_id=t.id
  where t.transaction_state in ('POSTED','REVERSED') group by t.id
  having coalesce(sum(case e.entry_side when 'DEBIT' then e.amount_cents else -e.amount_cents end),0)<>0
) q
union all select 'orphan_ledger_entries',count(*) from public.financial_ledger_entries e
  left join public.financial_transactions t on t.id=e.transaction_id left join public.financial_accounts a on a.id=e.account_id
  where t.id is null or a.id is null
union all select 'orphan_financial_transactions',count(*) from public.financial_transactions t where
  (source_type='TRIP' and not exists(select 1 from public.trips s where s.id=t.source_id)) or
  (source_type='DRIVER_PAYMENT_REQUEST' and not exists(select 1 from public.driver_payment_requests s where s.id=t.source_id)) or
  (source_type='DRIVER_SETTLEMENT' and not exists(select 1 from public.driver_settlements s where s.id=t.source_id)) or
  (source_type='DRIVER_SUBSCRIPTION_PAYMENT' and not exists(select 1 from public.driver_subscription_payments s where s.id=t.source_id)) or
  (source_type='TRIP_CANCELLATION_FEE' and not exists(select 1 from public.trip_cancellation_fees s where s.id=t.source_id)) or
  (source_type='FINANCIAL_TRANSACTION' and not exists(select 1 from public.financial_transactions s where s.id=t.source_id)) or
  (source_type='ADJUSTMENT' and source_id is null)
union all select 'forbidden_duplicate_financial_sources',count(*) from (
  select transaction_type,source_type,source_id from public.financial_transactions where transaction_state in ('POSTED','REVERSED')
  group by transaction_type,source_type,source_id having count(*)>1
) q
union all select 'duplicate_payment_allocations',count(*) from (
  select 'settlement' as kind,payment_request_id from public.driver_settlements where payment_request_id is not null group by payment_request_id having count(*)>1
  union all select 'subscription',payment_request_id from public.driver_subscription_payments where payment_request_id is not null group by payment_request_id having count(*)>1
) q
union all select 'duplicate_unapplied_credits',count(*) from (
  select e.transaction_id,e.account_id from public.financial_ledger_entries e join public.financial_accounts a on a.id=e.account_id
  join public.financial_transactions t on t.id=e.transaction_id where a.account_category='DRIVER_UNAPPLIED_CREDIT'
  and e.entry_side='CREDIT' and t.transaction_type='DRIVER_PAYMENT' group by e.transaction_id,e.account_id having count(*)>1
) q
union all select 'invalid_reversals',count(*) from public.financial_transactions r
  left join public.financial_transactions o on o.id=r.reversal_of_transaction_id
  where r.transaction_type='REVERSAL' and (o.id is null or r.source_type<>'FINANCIAL_TRANSACTION' or r.source_id<>o.id or exists(
    select e.account_id from public.financial_ledger_entries e where e.transaction_id in(r.id,o.id)
    group by e.account_id having sum(case e.entry_side when 'DEBIT' then e.amount_cents else -e.amount_cents end)<>0
  ))
union all select 'duplicate_opening_balances',count(*) from (
  select metadata->>'driver_id' from public.financial_transactions where metadata->>'event'='opening_balance'
    and transaction_state in ('POSTED','REVERSED') group by metadata->>'driver_id' having count(*)>1
) q
union all select 'partial_finalized_transactions',count(*) from public.financial_transactions t where
  t.transaction_state='PENDING' or (t.transaction_state in ('POSTED','REVERSED') and
    (t.posted_at is null or (select count(*) from public.financial_ledger_entries e where e.transaction_id=t.id)<2))
union all select 'contradictory_terminal_outcomes',count(*) from (
  select economic_trip_id from public.financial_transactions where economic_trip_id is not null
  and transaction_type in ('TRIP_FINANCIAL_COMPLETION','CANCELLATION_FEE','NO_SHOW_FEE')
  and transaction_state in ('PENDING','POSTED','REVERSED') group by economic_trip_id having count(*)>1
) q
union all select 'successfully_recovered_shadow_events_left_unresolved',count(*) from public.phase2_shadow_reconciliations r
  where r.error_code is not null and exists(select 1 from public.financial_transactions t
    where t.idempotency_key=r.operation_key and t.transaction_state='POSTED')
)
select * from checks order by check_name;
