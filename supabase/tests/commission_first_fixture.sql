-- Verified disposable database only. Requires the Phase 1 ledger, Phase 2
-- policy, Phase 3 payment foundation, Phase 5 fare fields and FIN-04 migration.
-- Outputs synthetic identities for the allocation and separate-session tests.
-- Commits synthetic rows. Destroy the disposable target when finished.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);

create temporary table fin04_fixture (
  actor_id uuid, reviewer_id uuid, support_id uuid, driver_user_id uuid,
  customer_id uuid, driver_id uuid, trip_id uuid, payment_id uuid
);
insert into fin04_fixture select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();
do $$
declare
  f fin04_fixture%rowtype;
  wallet uuid;
  booked_at timestamptz := clock_timestamp();
begin
  select * into strict f from fin04_fixture;
  if exists(select 1 from public.commission_first_policy) then raise exception 'Use a fresh inactive disposable target'; end if;
  if exists(select 1 from public.phase2_finance_policy where mode = 'AUTHORITATIVE') then
    raise exception 'This fixture exercises legacy debt. Start with Phase 2 OFF or SHADOW';
  end if;
  insert into auth.users(id) values(f.actor_id),(f.reviewer_id),(f.support_id),(f.driver_user_id);
  insert into public.profiles(id,role) values(f.actor_id,'owner'),(f.reviewer_id,'admin'),
    (f.support_id,'support'),(f.driver_user_id,'driver')
    on conflict(id) do update set role=excluded.role;
  insert into public.customers(id,auth_user_id) values(f.customer_id,f.support_id);
  insert into public.drivers(id,first_name,status) values(f.driver_id,'FIN04 Synthetic','approved');
  insert into public.driver_wallets(driver_id,balance_due) values(f.driver_id,6.90) returning id into wallet;
  insert into public.commission_first_policy(version,activated_at,eligible_from)
    values('commission-first-v1',booked_at,booked_at);
end $$;

-- Reusable within this psql session for additional synthetic trip scenarios.
create function pg_temp.fin04_trip(p_trip uuid, p_option text, p_completed timestamptz, p_commission bigint)
returns uuid language plpgsql as $$
declare
  f fin04_fixture%rowtype;
  wallet uuid;
  fee uuid;
  funds public.financial_accounts;
  clearing public.financial_accounts;
  receivable public.financial_accounts;
  payment_tx uuid;
  payment uuid := gen_random_uuid();
  total bigint := case p_option when 'group' then 5100 else 4900 end;
  driver_basis bigint;
begin
  select * into strict f from fin04_fixture;
  select id into strict wallet from public.driver_wallets where driver_id=f.driver_id;
  insert into public.trips(id,customer_id,ride_option,status,payment_method,fare_amount,original_fare,final_fare,
    phase5_ride_fare_cents,phase5_service_fee_cents,phase5_customer_total_cents)
    values(p_trip,f.customer_id,p_option,'requested','online',total/100.0,total/100.0,total/100.0,4600,total-4600,total);
  funds := public.phase1_ensure_financial_account('PLATFORM:CUSTOMER_FUNDS_LIABILITY:ZAR','UNAPPLIED_FUNDS','PLATFORM',null,'CREDIT','ZAR');
  clearing := public.phase1_ensure_financial_account('PLATFORM:PAYMENT_CLEARING:ZAR','PAYMENT_CLEARING','PLATFORM',null,'DEBIT','ZAR');
  receivable := public.phase1_ensure_financial_account('DRIVER:'||f.driver_id||':FIN04:ZAR',
    'COMMISSION_RECEIVABLE','DRIVER',f.driver_id,'DEBIT','ZAR');
  payment_tx := (public.phase1_post_financial_transaction('fin04-payment:'||p_trip,repeat('1',64),
    'ONLINE_PAYMENT','TRIP',p_trip,'ZAR','SYSTEM',null,clock_timestamp(),
    jsonb_build_array(jsonb_build_object('account_id',clearing.id,'entry_side','DEBIT','amount_cents',total),
      jsonb_build_object('account_id',funds.id,'entry_side','CREDIT','amount_cents',total)), '{}'::jsonb,null)->>'transaction_id')::uuid;
  insert into public.online_payment_attempts(id,customer_id,trip_id,provider,provider_checkout_id,provider_payment_id,amount_cents,
    fare_version,locked_fare_snapshot,state,verified_at,payment_ledger_transaction_id,idempotency_key,payload_hash)
  values(payment,f.customer_id,p_trip,'YOCO','fin04-checkout:'||p_trip,'fin04-payment:'||p_trip,total,
    repeat('a',64),'{}','SUCCEEDED',clock_timestamp(),payment_tx,'fin04-attempt:'||p_trip,repeat('b',64));
  insert into public.online_provider_events(provider,provider_event_id,payment_attempt_id,raw_event_type,raw_provider_status,
    body_sha256,trust_state,processing_state,verified_at,processed_at)
  values('YOCO','fin04-event:'||p_trip,payment,'payment.succeeded','succeeded',repeat('c',64),
    'VERIFIED','PROCESSED',clock_timestamp(),clock_timestamp());
  update public.trips set driver_id=f.driver_id,status='assigned' where id=p_trip;
  -- Before FIN-04, Phase 3 expected legacy net from the full customer fare.
  select case when p_completed < eligible_from then total else 4600 end into strict driver_basis
    from public.commission_first_policy where version='commission-first-v1';
  update public.trips set status='completed',completed_at=p_completed,commission_pct=15,commission_amount=p_commission/100.0,
    driver_net_earnings=(driver_basis-p_commission)/100.0 where id=p_trip;
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
    values('trip-complete:'||p_trip,'trip_completed','trip',p_trip,f.actor_id,'{}');
  insert into public.driver_wallet_transactions(driver_id,wallet_id,trip_id,tx_type,amount,direction,description)
    values(f.driver_id,wallet,p_trip,'commission',p_commission/100.0,'debit','Synthetic FIN04 trip commission');
  if p_commission > 0 then
  perform public.phase1_post_financial_transaction('fin04-commission:'||p_trip,repeat('2',64),
    'ADJUSTMENT','ADJUSTMENT',p_trip,'ZAR','OWNER',f.actor_id,clock_timestamp(),
    jsonb_build_array(jsonb_build_object('account_id',receivable.id,'entry_side','DEBIT','amount_cents',p_commission),
      jsonb_build_object('account_id',clearing.id,'entry_side','CREDIT','amount_cents',p_commission)), '{}'::jsonb,null);
  end if;
  fee := public.commission_first_record_provider_fee(f.actor_id,payment,'fin04-charge:'||p_trip,'fin04-statement:'||p_trip,171,200,371);
  perform public.commission_first_review_provider_fee(f.reviewer_id,fee,'fin04-charge:'||p_trip,171,200,371);
  return payment;
end $$;
update fin04_fixture set payment_id=pg_temp.fin04_trip(trip_id,'go',clock_timestamp(),690);
select * from fin04_fixture;
commit;
