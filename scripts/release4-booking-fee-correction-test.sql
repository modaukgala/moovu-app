\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() <> 'release4_finance_20261020' then
    raise exception 'The booking-fee test requires the isolated Release 4 local clone';
  end if;
end $$;
select set_config('request.jwt.claim.role','service_role',true);

insert into public.phase5_policies(version,effective_from,currency,membership_price_cents,
  membership_days,go_service_fee_cents,go_xl_service_fee_cents,member_waiver_bps,
  referrer_reward_cents,referee_reward_cents,credit_expiry_days,automatic_renewal,
  referral_qualification,active)
values('release4-synthetic-only',now()-interval '1 day','ZAR',9900,30,300,500,10000,
  2000,1000,90,false,'FIRST_ELIGIBLE_COMPLETED_RIDE',false);

insert into public.trips(id,customer_id,driver_id,pickup_address,dropoff_address,status,
  completed_at,payment_method,fare_amount,final_fare,original_fare,ride_option,
  commission_amount,driver_net_earnings,phase5_policy_version,phase5_policy_effective_from,
  phase5_ride_fare_cents,phase5_service_fee_cents,phase5_membership_waiver_cents,
  phase5_credit_cents,phase5_customer_total_cents,phase5_driver_fare_basis_cents)
values('a4300000-0000-4000-8000-000000000003',
  'a4100000-0000-4000-8000-000000000001',
  'a4200000-0000-4000-8000-000000000001','Synthetic pickup','Synthetic destination',
  'completed',now(),'online',103,103,103,'go',15,85,
  'release4-synthetic-only',now()-interval '1 day',10000,300,0,0,10300,10000);

do $$ begin
  begin
    perform public.phase5_post_service_fee('a4300000-0000-4000-8000-000000000003',
      'a4000000-0000-4000-8000-000000000001');
    raise exception 'Online booking fee was posted without verified payment';
  exception when others then
    if sqlerrm <> 'Verified online payment is required for booking fee' then raise; end if;
  end;
end $$;
\echo UNVERIFIED_ONLINE_PAYMENT_REJECTED

do $$ declare clearing public.financial_accounts; funds public.financial_accounts;
  posted jsonb; result jsonb; replay jsonb; begin
  clearing:=public.phase1_ensure_financial_account('PLATFORM:PAYMENT_CLEARING:ZAR',
    'PAYMENT_CLEARING','PLATFORM',null,'DEBIT','ZAR');
  funds:=public.phase1_ensure_financial_account('PLATFORM:CUSTOMER_FUNDS_LIABILITY:ZAR',
    'UNAPPLIED_FUNDS','PLATFORM',null,'CREDIT','ZAR');
  posted:=public.phase1_post_financial_transaction('release4:synthetic-payment:online',
    repeat('a',64),'ONLINE_PAYMENT','TRIP','a4300000-0000-4000-8000-000000000003',
    'ZAR','SYSTEM',null,now(),jsonb_build_array(
      jsonb_build_object('account_id',clearing.id,'entry_side','DEBIT','amount_cents',10300),
      jsonb_build_object('account_id',funds.id,'entry_side','CREDIT','amount_cents',10300)),
    jsonb_build_object('synthetic',true));
  insert into public.online_payment_attempts(customer_id,trip_id,provider,amount_cents,
    fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at,
    payment_ledger_transaction_id)
  values('a4100000-0000-4000-8000-000000000001',
    'a4300000-0000-4000-8000-000000000003','FAKE_TEST',10300,repeat('b',64),
    '{}'::jsonb,'SUCCEEDED','release4:synthetic-attempt:online',repeat('c',64),now(),
    (posted->>'transaction_id')::uuid);
  result:=public.phase5_post_service_fee('a4300000-0000-4000-8000-000000000003',
    'a4000000-0000-4000-8000-000000000001');
  replay:=public.phase5_post_service_fee('a4300000-0000-4000-8000-000000000003',
    'a4000000-0000-4000-8000-000000000001');
  if (result->>'amount_cents')::bigint<>300 or replay->>'replayed'<>'true' then
    raise exception 'Booking fee amount or replay failed'; end if;
end $$;

do $$ declare platform_debit integer; driver_debit integer; revenue_credit integer;
  transaction_count integer; begin
  select count(*) into platform_debit from public.financial_ledger_entries e
  join public.financial_transactions t on t.id=e.transaction_id
  join public.financial_accounts a on a.id=e.account_id
  where t.idempotency_key='phase5:service-fee:a4300000-0000-4000-8000-000000000003'
    and a.account_category='UNAPPLIED_FUNDS' and a.owner_type='PLATFORM'
    and e.entry_side='DEBIT' and e.amount_cents=300;
  select count(*) into driver_debit from public.financial_ledger_entries e
  join public.financial_transactions t on t.id=e.transaction_id
  join public.financial_accounts a on a.id=e.account_id
  where t.idempotency_key='phase5:service-fee:a4300000-0000-4000-8000-000000000003'
    and a.account_category='COMMISSION_RECEIVABLE' and a.owner_type='DRIVER';
  select count(*) into revenue_credit from public.financial_ledger_entries e
  join public.financial_transactions t on t.id=e.transaction_id
  join public.financial_accounts a on a.id=e.account_id
  where t.idempotency_key='phase5:service-fee:a4300000-0000-4000-8000-000000000003'
    and a.account_category='BOOKING_FEE_REVENUE' and e.entry_side='CREDIT'
    and e.amount_cents=300;
  select count(*) into transaction_count from public.financial_transactions
  where idempotency_key='phase5:service-fee:a4300000-0000-4000-8000-000000000003';
  if platform_debit<>1 or driver_debit<>0 or revenue_credit<>1 or transaction_count<>1 then
    raise exception 'Online booking fee allocation or idempotency failed'; end if;
end $$;
\echo VERIFIED_SYNTHETIC_ONLINE_R3_POSTS_TO_MOOVU_ONCE

insert into public.trips(id,customer_id,driver_id,pickup_address,dropoff_address,status,
  completed_at,payment_method,fare_amount,final_fare,original_fare,ride_option,
  commission_amount,driver_net_earnings,phase5_policy_version,phase5_policy_effective_from,
  phase5_ride_fare_cents,phase5_service_fee_cents,phase5_membership_waiver_cents,
  phase5_credit_cents,phase5_customer_total_cents,phase5_driver_fare_basis_cents)
values('a4300000-0000-4000-8000-000000000004',
  'a4100000-0000-4000-8000-000000000001',
  'a4200000-0000-4000-8000-000000000001','Synthetic pickup','Synthetic destination',
  'completed',now(),'cash',103,103,103,'go',15,85,
  'release4-synthetic-only',now()-interval '1 day',10000,300,0,0,10300,10000);
select public.phase5_post_service_fee('a4300000-0000-4000-8000-000000000004',
  'a4000000-0000-4000-8000-000000000001');
do $$ begin
  if (select count(*) from public.financial_ledger_entries e
      join public.financial_transactions t on t.id=e.transaction_id
      join public.financial_accounts a on a.id=e.account_id
      where t.idempotency_key='phase5:service-fee:a4300000-0000-4000-8000-000000000004'
        and a.account_category='COMMISSION_RECEIVABLE' and a.owner_type='DRIVER'
        and e.entry_side='DEBIT' and e.amount_cents=300)<>1 then
    raise exception 'Cash booking fee must remain a Driver receivable';
  end if;
end $$;
\echo SYNTHETIC_CASH_R3_REMAINS_DRIVER_RECEIVABLE
rollback;
