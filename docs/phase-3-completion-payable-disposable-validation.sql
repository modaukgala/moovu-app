-- Disposable-only transactional validation of the new payable RPC.
-- This is a database contract test, NOT application E2E proof.
-- Target ref: tangtlmdpnvmoviwrgvd. Never run on production.
begin;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

insert into public.customers(id,auth_user_id)
values('96000000-0000-4000-8000-000000000001','02cee19f-fdcf-403f-9af1-2ea6a219c0e6');
insert into public.trips(id,customer_id,status,payment_method,fare_amount,original_fare)
values('96100000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001',
  'requested','online',100,100);
insert into public.online_payment_attempts(
  id,customer_id,trip_id,provider,provider_checkout_id,provider_payment_id,
  amount_cents,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash
) values (
  '96200000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001',
  '96100000-0000-4000-8000-000000000001','FAKE_TEST','payable-checkout-1','payable-payment-1',
  10000,repeat('a',64),'{"fare":"100.00"}','PENDING','payable-attempt-1',repeat('b',64)
);

do $$ begin
  begin
    perform public.phase3_post_completed_online_driver_payable('96100000-0000-4000-8000-000000000001');
    raise exception 'premature payable accepted';
  exception when others then
    if sqlerrm='premature payable accepted' then raise; end if;
  end;
end $$;

do $$ declare result jsonb; begin
  result:=public.phase3_process_trusted_payment_event(
    'FAKE_TEST','payable-event-1','payment.succeeded','fake.paid',repeat('c',64),
    'payable-checkout-1','payable-payment-1',10000,'ZAR','SUCCEEDED');
  if result->>'result'<>'SUCCEEDED' then raise exception 'trusted success failed'; end if;
end $$;
update public.trips set driver_id='22222222-2222-4222-8222-22222222bb01',status='assigned'
where id='96100000-0000-4000-8000-000000000001';
update public.trips set status='completed',completed_at=now(),commission_pct=10,
  commission_amount=10,driver_net_earnings=90
where id='96100000-0000-4000-8000-000000000001';
insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
values('trip-complete:96100000-0000-4000-8000-000000000001','trip_completed','trip',
  '96100000-0000-4000-8000-000000000001','02cee19f-fdcf-403f-9af1-2ea6a219c0e6','{}');
insert into public.driver_wallets(driver_id,balance_due,total_commission,total_driver_net,
  total_trips_completed,account_status,updated_at)
values('22222222-2222-4222-8222-22222222bb01',0,0,0,0,'settled',now());
insert into public.driver_wallet_transactions(driver_id,wallet_id,trip_id,tx_type,amount,
  direction,description,meta,created_by)
select '22222222-2222-4222-8222-22222222bb01',id,
  '96100000-0000-4000-8000-000000000001','commission',10,'debit',
  'Synthetic legacy-authoritative commission','{}','02cee19f-fdcf-403f-9af1-2ea6a219c0e6'
from public.driver_wallets where driver_id='22222222-2222-4222-8222-22222222bb01';

do $$ declare first_result jsonb; replay_result jsonb; begin
  first_result:=public.phase3_post_completed_online_driver_payable('96100000-0000-4000-8000-000000000001');
  replay_result:=public.phase3_post_completed_online_driver_payable('96100000-0000-4000-8000-000000000001');
  if first_result->>'result'<>'CREATED' or replay_result->>'result'<>'REPLAYED'
    or (first_result->>'payable_cents')::bigint<>9000
    or (select count(*) from public.online_driver_payables
        where trip_id='96100000-0000-4000-8000-000000000001')<>1
    or (select count(*) from public.financial_transactions
        where idempotency_key='online_service_completion:96100000-0000-4000-8000-000000000001'
          and transaction_state='POSTED')<>1
    or (select count(*) from public.financial_ledger_entries e
        join public.financial_transactions ft on ft.id=e.transaction_id
        where ft.idempotency_key='online_service_completion:96100000-0000-4000-8000-000000000001')<>3
    or (select ledger_transaction_id is null from public.online_driver_payables
        where trip_id='96100000-0000-4000-8000-000000000001')
  then raise exception 'payable create/replay invariant failed'; end if;
end $$;
rollback;
