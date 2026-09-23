-- Phase 3 provider-independent database validation.
-- TARGET ONLY: tangtlmdpnvmoviwrgvd (moovu-phase-05g-disposable).
-- Never execute against production mvazbszenqahgqpznhhq.
-- All fixtures in this script are rolled back.
begin;

insert into public.customers(id,auth_user_id) values
  ('93000000-0000-4000-8000-000000000001','02cee19f-fdcf-403f-9af1-2ea6a219c0e6'),
  ('93000000-0000-4000-8000-000000000002','10000000-0000-0000-0000-000000000001');

insert into public.trips(id,customer_id,status,payment_method,completed_at) values
  ('93100000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','requested','cash',null),
  ('93100000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001','requested','other',null),
  ('93100000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000001','requested','online',null),
  ('93100000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000001','requested','online',null),
  ('93100000-0000-4000-8000-000000000005','93000000-0000-4000-8000-000000000001','requested','online',null),
  ('93100000-0000-4000-8000-000000000006','93000000-0000-4000-8000-000000000001','requested','online',null),
  ('93100000-0000-4000-8000-000000000007','93000000-0000-4000-8000-000000000001','requested','online',null),
  ('93100000-0000-4000-8000-000000000008','93000000-0000-4000-8000-000000000001','requested','online',null),
  ('93100000-0000-4000-8000-000000000009','93000000-0000-4000-8000-000000000001','requested','online',null),
  ('93100000-0000-4000-8000-000000000010','93000000-0000-4000-8000-000000000001','requested','online',null);

-- Cash and Transfer-compatible (legacy `other`) dispatch remain unaffected.
insert into public.driver_trip_offers(trip_id,driver_id,status) values
 ('93100000-0000-4000-8000-000000000001','22222222-2222-4222-8222-22222222bb01','pending'),
 ('93100000-0000-4000-8000-000000000002','22222222-2222-4222-8222-22222222bb01','pending');
update public.trips set driver_id='22222222-2222-4222-8222-22222222bb01',status='assigned'
where id in ('93100000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000002');

-- No online evidence fails closed at both offer and assignment boundaries.
do $$ begin
  begin
    insert into public.driver_trip_offers(trip_id,driver_id,status) values
      ('93100000-0000-4000-8000-000000000003','22222222-2222-4222-8222-22222222bb01','pending');
    raise exception 'expected online offer without payment to fail';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Online payment must be verified%' then raise; end if;
  end;
  begin
    update public.trips set driver_id='22222222-2222-4222-8222-22222222bb01',status='assigned'
    where id='93100000-0000-4000-8000-000000000003';
    raise exception 'expected online assignment without payment to fail';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Online payment must be verified%' then raise; end if;
  end;
end $$;

insert into public.online_payment_attempts(
 id,customer_id,trip_id,provider,amount_cents,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash
) values
 ('93200000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000004','FAKE_TEST',10000,repeat('1',64),'{}','CREATED','p3-created',repeat('a',64)),
 ('93200000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000005','FAKE_TEST',10000,repeat('2',64),'{}','PENDING','p3-pending',repeat('b',64)),
 ('93200000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000006','FAKE_TEST',10000,repeat('3',64),'{}','FAILED','p3-failed',repeat('c',64)),
 ('93200000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000007','FAKE_TEST',10000,repeat('4',64),'{}','CANCELLED','p3-cancelled',repeat('d',64)),
 ('93200000-0000-4000-8000-000000000005','93000000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000008','FAKE_TEST',10000,repeat('5',64),'{}','EXPIRED','p3-expired',repeat('e',64));

-- CREATED/PENDING/FAILED/CANCELLED/EXPIRED evidence cannot dispatch.
do $$ declare trip uuid; begin
  foreach trip in array array[
    '93100000-0000-4000-8000-000000000004'::uuid,'93100000-0000-4000-8000-000000000005'::uuid,
    '93100000-0000-4000-8000-000000000006'::uuid,'93100000-0000-4000-8000-000000000007'::uuid,
    '93100000-0000-4000-8000-000000000008'::uuid
  ] loop
    begin
      insert into public.driver_trip_offers(trip_id,driver_id,status)
      values(trip,'22222222-2222-4222-8222-22222222bb01','pending');
      raise exception 'expected non-verified online offer to fail';
    exception when sqlstate 'P0001' then
      if sqlerrm not like 'Online payment must be verified%' then raise; end if;
    end;
  end loop;
end $$;

-- SUCCEEDED without verified_at is structurally impossible.
do $$ begin
  begin
    insert into public.online_payment_attempts(customer_id,trip_id,provider,amount_cents,fare_version,
      locked_fare_snapshot,state,idempotency_key,payload_hash)
    values('93000000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000009','FAKE_TEST',10000,
      repeat('6',64),'{}','SUCCEEDED','p3-unverified-success',repeat('f',64));
    raise exception 'expected unverified success to fail';
  exception when check_violation then null;
  end;
end $$;

-- Failed terminal attempts permit a retry; concurrent active attempts do not.
insert into public.online_payment_attempts(customer_id,trip_id,provider,amount_cents,fare_version,
 locked_fare_snapshot,state,idempotency_key,payload_hash)
values('93000000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000006','YOCO',10000,
 repeat('3',64),'{}','PENDING','p3-failed-retry',repeat('0',64));
do $$ begin
  begin
    insert into public.online_payment_attempts(customer_id,trip_id,provider,amount_cents,fare_version,
      locked_fare_snapshot,state,idempotency_key,payload_hash)
    values('93000000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000005','YOCO',10000,
      repeat('2',64),'{}','CREATED','p3-active-conflict',repeat('9',64));
    raise exception 'expected active fare conflict to fail';
  exception when unique_violation then null;
  end;
end $$;

-- Valid lifecycle, synthetic verified success, and dispatch.
insert into public.online_payment_attempts(
 id,customer_id,trip_id,provider,provider_checkout_id,provider_payment_id,amount_cents,fare_version,
 locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at
) values('93200000-0000-4000-8000-000000000006','93000000-0000-4000-8000-000000000001',
 '93100000-0000-4000-8000-000000000009','FAKE_TEST','checkout-1','payment-1',10000,repeat('7',64),
 '{"fare":"locked"}','SUCCEEDED','p3-success',repeat('8',64),now());
insert into public.driver_trip_offers(trip_id,driver_id,status)
values('93100000-0000-4000-8000-000000000009','22222222-2222-4222-8222-22222222bb01','pending');
update public.trips set driver_id='22222222-2222-4222-8222-22222222bb01',status='assigned'
where id='93100000-0000-4000-8000-000000000009';

-- Provider-scoped event and provider reference idempotency.
insert into public.online_provider_events(provider,provider_event_id,payment_attempt_id,raw_event_type,body_sha256)
values('FAKE_TEST','event-1','93200000-0000-4000-8000-000000000006','payment.succeeded',repeat('a',64));
do $$ begin
  begin
    insert into public.online_provider_events(provider,provider_event_id,raw_event_type,body_sha256)
    values('FAKE_TEST','event-1','payment.succeeded',repeat('a',64));
    raise exception 'expected duplicate provider event to fail';
  exception when unique_violation then null;
  end;
end $$;
insert into public.online_provider_events(provider,provider_event_id,raw_event_type,body_sha256)
values('YOCO','event-1','payment.succeeded',repeat('b',64));

do $$ begin
  begin
    insert into public.online_payment_attempts(customer_id,trip_id,provider,provider_checkout_id,amount_cents,
      fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash)
    values('93000000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000010','FAKE_TEST','checkout-1',10000,
      repeat('8',64),'{}','FAILED','p3-duplicate-checkout',repeat('7',64));
    raise exception 'expected duplicate provider checkout to fail';
  exception when unique_violation then null;
  end;
end $$;
insert into public.online_payment_attempts(customer_id,trip_id,provider,provider_checkout_id,provider_payment_id,
 amount_cents,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash)
values('93000000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000010','YOCO','checkout-1','payment-1',10000,
 repeat('8',64),'{}','FAILED','p3-cross-provider-ref',repeat('7',64));

-- Money constraints and ownership consistency.
do $$ begin
  begin
    insert into public.online_payment_attempts(customer_id,trip_id,provider,amount_cents,currency,fare_version,
      locked_fare_snapshot,state,idempotency_key,payload_hash)
    values('93000000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000010','FAKE_TEST',0,'ZAR',
      repeat('9',64),'{}','FAILED','p3-zero',repeat('6',64));
    raise exception 'expected zero cents to fail';
  exception when check_violation then null;
  end;
  begin
    insert into public.online_payment_attempts(customer_id,trip_id,provider,amount_cents,currency,fare_version,
      locked_fare_snapshot,state,idempotency_key,payload_hash)
    values('93000000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000010','FAKE_TEST',100,'USD',
      repeat('9',64),'{}','FAILED','p3-usd',repeat('6',64));
    raise exception 'expected non-ZAR to fail';
  exception when check_violation then null;
  end;
  begin
    insert into public.online_payment_attempts(customer_id,trip_id,provider,amount_cents,fare_version,
      locked_fare_snapshot,state,idempotency_key,payload_hash)
    values('93000000-0000-4000-8000-000000000002','93100000-0000-4000-8000-000000000010','FAKE_TEST',100,
      repeat('9',64),'{}','FAILED','p3-wrong-owner',repeat('6',64));
    raise exception 'expected wrong customer to fail';
  exception when others then
    if sqlerrm not like 'Online payment customer must own%' then raise; end if;
  end;
end $$;

-- Locked fare, provider identity, verified evidence and invalid state changes are immutable/fail closed.
do $$ begin
  begin
    update public.online_payment_attempts set amount_cents=9999 where id='93200000-0000-4000-8000-000000000006';
    raise exception 'expected locked amount mutation to fail';
  exception when others then if sqlerrm not like 'Online payment authority%' then raise; end if; end;
  begin
    update public.online_payment_attempts set provider_payment_id='replacement' where id='93200000-0000-4000-8000-000000000006';
    raise exception 'expected provider identity mutation to fail';
  exception when others then if sqlerrm not like 'Online payment authority%' then raise; end if; end;
  begin
    update public.online_payment_attempts set verified_at=null where id='93200000-0000-4000-8000-000000000006';
    raise exception 'expected verification mutation to fail';
  exception when others then if sqlerrm not like 'Online payment authority%' then raise; end if; end;
  begin
    update public.online_payment_attempts set state='FAILED' where id='93200000-0000-4000-8000-000000000006';
    raise exception 'expected invalid SUCCEEDED to FAILED transition to fail';
  exception when others then if sqlerrm not like 'Invalid online payment transition%' then raise; end if; end;
end $$;
update public.online_payment_attempts set state='PENDING' where id='93200000-0000-4000-8000-000000000001';
update public.online_payment_attempts set state='RECONCILIATION_REQUIRED' where id='93200000-0000-4000-8000-000000000002';
update public.online_payment_attempts set state='PENDING' where id='93200000-0000-4000-8000-000000000002';

-- Driver payable cannot exist before completion, then is unique after completion.
do $$ begin
  begin
    insert into public.online_driver_payables(trip_id,payment_attempt_id,driver_id,fare_cents,commission_cents,
      idempotency_key,earned_at)
    values('93100000-0000-4000-8000-000000000009','93200000-0000-4000-8000-000000000006',
      '22222222-2222-4222-8222-22222222bb01',10000,0,'p3-payable',now());
    raise exception 'expected pre-completion payable to fail';
  exception when others then if sqlerrm not like 'Driver payable requires%' then raise; end if; end;
end $$;
update public.trips set status='completed',completed_at=now() where id='93100000-0000-4000-8000-000000000009';
insert into public.online_driver_payables(trip_id,payment_attempt_id,driver_id,fare_cents,commission_cents,
 idempotency_key,earned_at)
values('93100000-0000-4000-8000-000000000009','93200000-0000-4000-8000-000000000006',
 '22222222-2222-4222-8222-22222222bb01',10000,0,'p3-payable',now());
do $$ begin
  begin
    insert into public.online_driver_payables(trip_id,payment_attempt_id,driver_id,fare_cents,commission_cents,
      idempotency_key,earned_at)
    values('93100000-0000-4000-8000-000000000009','93200000-0000-4000-8000-000000000006',
      '22222222-2222-4222-8222-22222222bb01',10000,0,'p3-payable-duplicate',now());
    raise exception 'expected duplicate payable to fail';
  exception when unique_violation then null;
  end;
  if (select payable_cents from public.online_driver_payables where idempotency_key='p3-payable')<>10000 then
    raise exception 'processor fees altered Driver payable';
  end if;
end $$;

-- Grants and RLS: no client mutation authority; customer read is row and column scoped.
do $$ begin
  if has_table_privilege('anon','public.online_payment_attempts','select')
    or has_table_privilege('anon','public.online_payment_attempts','insert')
    or has_table_privilege('authenticated','public.online_payment_attempts','insert')
    or has_table_privilege('authenticated','public.online_provider_events','insert')
    or has_table_privilege('authenticated','public.online_payment_refunds','insert')
    or has_table_privilege('authenticated','public.online_driver_payables','insert')
    or has_table_privilege('authenticated','public.online_payment_reconciliation_items','insert') then
    raise exception 'client mutation privilege leaked';
  end if;
  if has_column_privilege('authenticated','public.online_payment_attempts','payload_hash','select')
    or has_column_privilege('authenticated','public.online_payment_attempts','failure_message','select') then
    raise exception 'sensitive payment columns leaked';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','02cee19f-fdcf-403f-9af1-2ea6a219c0e6',true);
do $$ begin
  if (select count(*) from public.online_payment_attempts)=0 then
    raise exception 'owner could not read owned payment rows';
  end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ begin
  if (select count(*) from public.online_payment_attempts)<>0 then
    raise exception 'different customer could read payment rows';
  end if;
  begin
    update public.online_payment_attempts set state='SUCCEEDED';
    raise exception 'authenticated mutation unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.online_payment_attempts;
    raise exception 'anonymous payment read unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Phase 1 ledger: balanced post, exact replay, conflicting replay rejection,
-- unbalanced rejection, and one-to-one online-payment linkage. All roll back.
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare
  entries jsonb;
  first_result jsonb;
  replay_result jsonb;
  tx uuid;
begin
  select jsonb_build_array(
    jsonb_build_object('account_id',d.id,'entry_side','DEBIT','amount_cents',10000),
    jsonb_build_object('account_id',c.id,'entry_side','CREDIT','amount_cents',10000)
  ) into entries
  from public.financial_accounts d cross join public.financial_accounts c
  where d.account_code='PAYMENT_CLEARING' and c.account_code='PLATFORM:ADJUSTMENT_CLEARING:ZAR';
  first_result:=public.phase1_post_financial_transaction(
    'p3-ledger-exactly-once',repeat('4',64),'ONLINE_PAYMENT','TRIP',
    '93100000-0000-4000-8000-000000000009','ZAR','SYSTEM',null,now(),entries,
    '{"validation":"phase3-clearing-only-no-revenue"}'::jsonb,null);
  replay_result:=public.phase1_post_financial_transaction(
    'p3-ledger-exactly-once',repeat('4',64),'ONLINE_PAYMENT','TRIP',
    '93100000-0000-4000-8000-000000000009','ZAR','SYSTEM',null,now(),entries,
    '{"validation":"phase3-clearing-only-no-revenue"}'::jsonb,null);
  if first_result->>'replayed'<>'false' or replay_result->>'replayed'<>'true'
    or first_result->>'transaction_id'<>replay_result->>'transaction_id' then
    raise exception 'Phase 1 exact replay did not resolve to one transaction';
  end if;
  tx:=(first_result->>'transaction_id')::uuid;
  update public.online_payment_attempts set payment_ledger_transaction_id=tx
  where id='93200000-0000-4000-8000-000000000006';
  begin
    update public.online_payment_attempts set payment_ledger_transaction_id=tx
    where id=(select id from public.online_payment_attempts where idempotency_key='p3-cross-provider-ref');
    raise exception 'expected duplicate ledger link to fail';
  exception when unique_violation then null;
  end;
  begin
    perform public.phase1_post_financial_transaction(
      'p3-ledger-unbalanced',repeat('5',64),'ONLINE_PAYMENT','TRIP',
      '93100000-0000-4000-8000-000000000010','ZAR','SYSTEM',null,now(),
      jsonb_build_array(jsonb_build_object('account_id',(entries->0->>'account_id')::uuid,
        'entry_side','DEBIT','amount_cents',10000)), '{}'::jsonb,null);
    raise exception 'expected unbalanced financial transaction to fail';
  exception when others then
    if sqlerrm not like 'Entries must be valid%' then raise; end if;
  end;
end $$;
reset role;

-- Phase 1 schema continues to guarantee stable idempotency and balanced posted transactions.
do $$ begin
  if not exists(select 1 from pg_indexes where schemaname='public' and tablename='financial_transactions'
    and indexdef ilike '%idempotency_key%unique%') and not exists(
      select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
      where t.relname='financial_transactions' and c.contype='u'
        and pg_get_constraintdef(c.oid) ilike '%idempotency_key%') then
    raise exception 'Phase 1 financial idempotency constraint missing';
  end if;
  if not exists(select 1 from pg_trigger where tgname='phase1_assert_financial_transaction_balanced_trigger' and not tgisinternal) then
    raise exception 'Phase 1 balance constraint trigger missing';
  end if;
end $$;

rollback;
