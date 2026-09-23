-- Disposable-only, rolled-back integration test.
-- Target ref: tangtlmdpnvmoviwrgvd. Never run on production.
begin;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

insert into public.customers(id,auth_user_id)
values('95000000-0000-4000-8000-000000000001','02cee19f-fdcf-403f-9af1-2ea6a219c0e6');
insert into public.trips(id,customer_id,status,payment_method,fare_amount,original_fare) values
 ('95100000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','requested','online',100,100),
 ('95100000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000001','requested','online',100,100),
 ('95100000-0000-4000-8000-000000000003','95000000-0000-4000-8000-000000000001','requested','online',100,100),
 ('95100000-0000-4000-8000-000000000004','95000000-0000-4000-8000-000000000001','requested','online',100,100),
 ('95100000-0000-4000-8000-000000000005','95000000-0000-4000-8000-000000000001','requested','cash',100,100),
 ('95100000-0000-4000-8000-000000000006','95000000-0000-4000-8000-000000000001','requested','other',100,100);
insert into public.trips(id,customer_id,status,payment_method,fare_amount,original_fare)
values('95100000-0000-4000-8000-000000000007','95000000-0000-4000-8000-000000000001','requested','online',100,100);

insert into public.online_payment_attempts(
 id,customer_id,trip_id,provider,provider_checkout_id,provider_payment_id,
 amount_cents,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash
) values
 ('95200000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001',
  '95100000-0000-4000-8000-000000000001','FAKE_TEST','fake-checkout-1','fake-payment-1',
  10000,repeat('1',64),'{"fare":"100.00"}','PENDING','fake-attempt-1',repeat('a',64)),
 ('95200000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000001',
  '95100000-0000-4000-8000-000000000002','FAKE_TEST','fake-checkout-2','fake-payment-2',
  10000,repeat('2',64),'{"fare":"100.00"}','PENDING','fake-attempt-2',repeat('b',64)),
 ('95200000-0000-4000-8000-000000000003','95000000-0000-4000-8000-000000000001',
  '95100000-0000-4000-8000-000000000003','FAKE_TEST','fake-checkout-3','fake-payment-3',
  10000,repeat('3',64),'{"fare":"100.00"}','PENDING','fake-attempt-3',repeat('c',64)),
 ('95200000-0000-4000-8000-000000000004','95000000-0000-4000-8000-000000000001',
  '95100000-0000-4000-8000-000000000004','FAKE_TEST','fake-checkout-4','fake-payment-4',
  10000,repeat('4',64),'{"fare":"100.00"}','PENDING','fake-attempt-4',repeat('d',64));
insert into public.online_payment_attempts(
 id,customer_id,trip_id,provider,provider_checkout_id,provider_payment_id,
 amount_cents,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash
) values (
 '95200000-0000-4000-8000-000000000007','95000000-0000-4000-8000-000000000001',
 '95100000-0000-4000-8000-000000000007','FAKE_TEST','fake-checkout-7','fake-payment-7',
 10000,repeat('7',64),'{"fare":"100.00"}','PENDING','fake-attempt-7',repeat('7',64)
);

-- Both legacy methods bypass the online gate.
insert into public.driver_trip_offers(trip_id,driver_id,status) values
 ('95100000-0000-4000-8000-000000000005','22222222-2222-4222-8222-22222222bb01','pending'),
 ('95100000-0000-4000-8000-000000000006','22222222-2222-4222-8222-22222222bb01','pending');

-- Client return never occurs. Pending cannot dispatch.
do $$ begin
  begin
    insert into public.driver_trip_offers(trip_id,driver_id,status)
    values('95100000-0000-4000-8000-000000000001','22222222-2222-4222-8222-22222222bb01','pending');
    raise exception 'pending online dispatch unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Online payment must be verified%' then raise; end if;
  end;
end $$;

-- Failure is terminal and auditable; a second attempt for the same locked fare
-- is legitimate and does not rewrite the first attempt.
do $$ declare result jsonb; begin
  result:=public.phase3_process_trusted_payment_event(
    'FAKE_TEST','fake-event-failed','payment.failed','fake.failed',repeat('7',64),
    'fake-checkout-7','fake-payment-7',10000,'ZAR','FAILED');
  if result->>'result'<>'FAILED' then raise exception 'failed event not processed'; end if;
  insert into public.online_payment_attempts(
    customer_id,trip_id,provider,amount_cents,fare_version,locked_fare_snapshot,
    state,idempotency_key,payload_hash
  ) values (
    '95000000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000007',
    'FAKE_TEST',10000,repeat('7',64),'{"fare":"100.00"}','CREATED','fake-attempt-7-retry',repeat('8',64)
  );
  if (select state from public.online_payment_attempts
      where id='95200000-0000-4000-8000-000000000007')<>'FAILED' then
    raise exception 'failed attempt history was rewritten';
  end if;
end $$;

-- Delayed trusted synthetic success creates one clearing transaction.
do $$ declare result jsonb; duplicate jsonb; begin
  result:=public.phase3_process_trusted_payment_event(
    'FAKE_TEST','fake-event-success','payment.succeeded','fake.paid',repeat('e',64),
    'fake-checkout-1','fake-payment-1',10000,'ZAR','SUCCEEDED');
  duplicate:=public.phase3_process_trusted_payment_event(
    'FAKE_TEST','fake-event-success','payment.succeeded','fake.paid',repeat('e',64),
    'fake-checkout-1','fake-payment-1',10000,'ZAR','SUCCEEDED');
  if result->>'result'<>'SUCCEEDED' or duplicate->>'result'<>'REPLAYED' then
    raise exception 'success or duplicate event result incorrect';
  end if;
  if (select count(*) from public.online_provider_events where provider_event_id='fake-event-success')<>1
    or (select count(*) from public.financial_transactions where idempotency_key='online_payment:95200000-0000-4000-8000-000000000001')<>1
    or (select count(*) from public.online_driver_payables where trip_id='95100000-0000-4000-8000-000000000001')<>0 then
    raise exception 'duplicate payment or premature payable';
  end if;
  -- A later contradictory failure must not regress an authorized success.
  result:=public.phase3_process_trusted_payment_event(
    'FAKE_TEST','fake-event-late-failure','payment.failed','fake.failed',repeat('6',64),
    'fake-checkout-1','fake-payment-1',10000,'ZAR','FAILED');
  if result->>'reason'<>'INVALID_PAYMENT_STATE'
    or (select state from public.online_payment_attempts
      where id='95200000-0000-4000-8000-000000000001')<>'SUCCEEDED' then
    raise exception 'late failure regressed successful payment';
  end if;
end $$;

-- Database releases dispatch only after trusted processing.
insert into public.driver_trip_offers(trip_id,driver_id,status)
values('95100000-0000-4000-8000-000000000001','22222222-2222-4222-8222-22222222bb01','pending');
update public.trips set driver_id='22222222-2222-4222-8222-22222222bb01',status='assigned'
where id='95100000-0000-4000-8000-000000000001';
update public.trips set status='completed',completed_at=now()
where id='95100000-0000-4000-8000-000000000001';
insert into public.online_driver_payables(
 trip_id,payment_attempt_id,driver_id,fare_cents,commission_cents,idempotency_key,earned_at
) values (
 '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',
 '22222222-2222-4222-8222-22222222bb01',10000,0,'fake-payable-1',now()
);

-- R90 mismatch, USD mismatch, wrong payment, and orphan checkout all retain
-- reconciliation evidence and cannot create paid dispatch or ledger effects.
do $$ declare result jsonb; begin
  result:=public.phase3_process_trusted_payment_event(
    'FAKE_TEST','fake-event-amount','payment.succeeded','fake.paid',repeat('f',64),
    'fake-checkout-2','fake-payment-2',9000,'ZAR','SUCCEEDED');
  if result->>'reason'<>'AMOUNT_MISMATCH' then raise exception 'amount mismatch accepted'; end if;
  result:=public.phase3_process_trusted_payment_event(
    'FAKE_TEST','fake-event-currency','payment.succeeded','fake.paid',repeat('1',64),
    'fake-checkout-3','fake-payment-3',10000,'USD','SUCCEEDED');
  if result->>'reason'<>'CURRENCY_MISMATCH' then raise exception 'currency mismatch accepted'; end if;
  result:=public.phase3_process_trusted_payment_event(
    'FAKE_TEST','fake-event-wrong-reference','payment.succeeded','fake.paid',repeat('2',64),
    'fake-checkout-4','wrong-payment-id',10000,'ZAR','SUCCEEDED');
  if result->>'reason'<>'PROVIDER_PAYMENT_REFERENCE_MISMATCH' then raise exception 'wrong payment ID accepted'; end if;
  result:=public.phase3_process_trusted_payment_event(
    'FAKE_TEST','fake-event-orphan','payment.succeeded','fake.paid',repeat('3',64),
    'unknown-checkout','unknown-payment',10000,'ZAR','SUCCEEDED');
  if result->>'reason'<>'ORPHAN_PROVIDER_PAYMENT' then raise exception 'orphan payment accepted'; end if;
  if (select count(*) from public.online_payment_reconciliation_items
      where provider_settlement_reference like 'fake-event-%'
        and provider_settlement_reference<>'fake-event-late-failure')<>4 then
    raise exception 'mismatch evidence missing';
  end if;
  if (select count(*) from public.financial_transactions
      where source_id in ('95100000-0000-4000-8000-000000000002'::uuid,
        '95100000-0000-4000-8000-000000000003'::uuid,
        '95100000-0000-4000-8000-000000000004'::uuid))<>0 then
    raise exception 'mismatch posted financial effect';
  end if;
end $$;

-- Locked fare remains unchanged despite subsequent trip lifecycle mutation.
do $$ begin
  if (select amount_cents from public.online_payment_attempts where id='95200000-0000-4000-8000-000000000001')<>10000
    or (select locked_fare_snapshot from public.online_payment_attempts
      where id='95200000-0000-4000-8000-000000000001')<>'{"fare":"100.00"}'::jsonb then
    raise exception 'locked fare changed';
  end if;
  if (select count(*) from public.financial_ledger_entries e
      join public.financial_transactions t on t.id=e.transaction_id
      join public.financial_accounts a on a.id=e.account_id
      where t.idempotency_key='online_payment:95200000-0000-4000-8000-000000000001'
        and a.account_category in ('COMMISSION_REVENUE','BOOKING_FEE_REVENUE'))<>0 then
    raise exception 'pre-service customer funds recognized as revenue';
  end if;
end $$;

rollback;
