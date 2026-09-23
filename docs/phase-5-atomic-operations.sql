-- MOOVU Phase 5 atomic booking, credit, referral and completion-basis operations.
-- Depends on phase-5-customer-monetisation-migration.sql. Install before activating a policy.
begin;

create or replace function public.phase5_issue_credit(
  p_customer_id uuid,p_amount_cents bigint,p_source_type text,p_source_id uuid,p_policy_version text,
  p_idempotency_key text,p_actor_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare i public.phase5_credit_issuances; a_control public.financial_accounts; a_credit public.financial_accounts;
  posted jsonb; payload text;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted server role required'; end if;
  if p_amount_cents<=0 or p_source_type not in ('REFERRER_REWARD','REFEREE_REWARD','ADMIN_ADJUSTMENT') then raise exception 'Invalid credit issuance'; end if;
  if p_source_type='ADMIN_ADJUSTMENT' and not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin')) then raise exception 'Owner or Admin required'; end if;
  select * into i from public.phase5_credit_issuances where idempotency_key=p_idempotency_key;
  if found then
    if i.customer_id<>p_customer_id or i.amount_cents<>p_amount_cents or i.source_id<>p_source_id then raise exception 'Conflicting credit replay'; end if;
    return jsonb_build_object('issuance_id',i.id,'replayed',true);
  end if;
  a_control:=public.phase1_ensure_financial_account(coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM' and owner_id is null and account_category='ADJUSTMENT_CLEARING' and currency='ZAR'),'PHASE5:PROMO:CONTROL'),'ADJUSTMENT_CLEARING','PLATFORM',null,'CREDIT','ZAR');
  a_credit:=public.phase1_ensure_financial_account(coalesce((select account_code from public.financial_accounts where owner_type='CUSTOMER' and owner_id=p_customer_id and account_category='CUSTOMER_PROMOTIONAL_CREDIT' and currency='ZAR'),'PHASE5:CUSTOMER:'||upper(p_customer_id::text)||':PROMO'),'CUSTOMER_PROMOTIONAL_CREDIT','CUSTOMER',p_customer_id,'CREDIT','ZAR');
  insert into public.phase5_credit_issuances(customer_id,amount_cents,source_type,source_id,policy_version,idempotency_key,
    issued_at,expires_at,status,issued_by,reason)
  values(p_customer_id,p_amount_cents,p_source_type,p_source_id,p_policy_version,p_idempotency_key,now(),now()+interval '90 days','ACTIVE',p_actor_id,trim(p_reason))
  returning * into i;
  payload:=i.id||':'||p_customer_id||':'||p_amount_cents||':'||p_source_type||':'||p_source_id;
  posted:=public.phase1_post_financial_transaction('phase5:credit-issue:'||i.id,
    encode(digest(convert_to(payload,'UTF8'),'sha256'),'hex'),
    case when p_source_type in ('REFERRER_REWARD','REFEREE_REWARD') then 'REFERRAL_CREDIT' else 'ADJUSTMENT' end,
    'ADJUSTMENT',i.id,'ZAR',case when p_actor_id is null then 'SYSTEM' else 'ADMIN' end,p_actor_id,now(),
    jsonb_build_array(jsonb_build_object('account_id',a_control.id,'entry_side','DEBIT','amount_cents',p_amount_cents),
      jsonb_build_object('account_id',a_credit.id,'entry_side','CREDIT','amount_cents',p_amount_cents)),
    jsonb_build_object('non_cash',true,'source_type',p_source_type,'source_id',p_source_id,'policy_version',p_policy_version));
  update public.phase5_credit_issuances set financial_transaction_id=(posted->>'transaction_id')::uuid where id=i.id;
  insert into public.phase5_audit_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('credit-issued:'||i.id,'PROMOTIONAL_CREDIT_ISSUED','CREDIT_ISSUANCE',i.id,p_actor_id,
    jsonb_build_object('customer_id',p_customer_id,'amount_cents',p_amount_cents,'source_type',p_source_type));
  return jsonb_build_object('issuance_id',i.id,'financial_transaction_id',posted->>'transaction_id','replayed',false);
end $$;

create or replace function public.phase5_reverse_credit(p_issuance_id uuid,p_actor_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare i public.phase5_credit_issuances; reversed jsonb;
begin
  if auth.role()<>'service_role' or not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin')) then raise exception 'Owner or Admin required'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Reversal reason required'; end if;
  select * into i from public.phase5_credit_issuances where id=p_issuance_id for update;
  if not found then raise exception 'Credit issuance not found'; end if;
  if i.status='REVERSED' then return jsonb_build_object('issuance_id',i.id,'replayed',true); end if;
  if exists(select 1 from public.phase5_credit_redemptions where issuance_id=i.id) then raise exception 'Spent credit cannot be reversed independently'; end if;
  reversed:=public.phase1_reverse_financial_transaction(i.financial_transaction_id,'phase5:credit-reversal:'||i.id,
    encode(digest(convert_to(i.id||':'||trim(p_reason),'UTF8'),'sha256'),'hex'),p_actor_id,trim(p_reason));
  update public.phase5_credit_issuances set status='REVERSED' where id=i.id;
  insert into public.phase5_audit_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('credit-reversed:'||i.id,'PROMOTIONAL_CREDIT_REVERSED','CREDIT_ISSUANCE',i.id,p_actor_id,
    jsonb_build_object('reason',trim(p_reason),'financial_transaction_id',reversed->>'transaction_id'));
  return jsonb_build_object('issuance_id',i.id,'financial_transaction_id',reversed->>'transaction_id','replayed',false);
end $$;

create or replace function public.phase5_create_trip(
  p_customer_id uuid,p_actor_id uuid,p_booking_key text,p_trip_payload jsonb,p_ride_fare_cents bigint,
  p_ride_option text,p_expected_customer_total_cents bigint
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare pol public.phase5_policies; membership public.phase5_memberships; existing public.trips; created public.trips;
  debt jsonb; fee bigint; waiver bigint; available bigint; applied bigint; total bigint; remaining bigint; take bigint;
  issue record; a_credit public.financial_accounts; a_driver public.financial_accounts; a_revenue public.financial_accounts;
  fare_credit bigint; driver_credit bigint; entries jsonb:='[]'::jsonb; posted jsonb; payload text; redemption_key text;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted server role required'; end if;
  if length(trim(coalesce(p_booking_key,'')))<8 or p_ride_fare_cents<=0 or p_ride_option not in ('go','group') then raise exception 'Invalid booking contract'; end if;
  if (p_trip_payload->>'customer_id')::uuid<>p_customer_id or p_actor_id is null then raise exception 'Booking identity mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended('phase5-booking:'||p_customer_id::text,0));
  select * into existing from public.trips where phase5_booking_key=p_booking_key;
  if found then
    if existing.customer_id<>p_customer_id then raise exception 'Conflicting booking replay'; end if;
    return jsonb_build_object('trip',to_jsonb(existing),'replayed',true);
  end if;
  debt:=public.phase4_customer_debt_state(p_customer_id);
  if coalesce((debt->>'booking_blocked')::boolean,false) then raise exception 'PHASE4_BOOKING_BLOCKED'; end if;
  select * into pol from public.phase5_policy_at(now());
  if pol.version is null then raise exception 'Phase 5 policy unavailable'; end if;
  select * into membership from public.phase5_memberships where customer_id=p_customer_id and status='ACTIVE'
    and starts_at<=now() and expires_at>now() order by expires_at desc limit 1 for share;
  fee:=case when p_ride_option='go' then pol.go_service_fee_cents else pol.go_xl_service_fee_cents end;
  waiver:=case when membership.id is null then 0 else fee end;
  select coalesce(sum(i.amount_cents-coalesce(r.used,0)),0) into available
  from public.phase5_credit_issuances i
  left join (select issuance_id,sum(amount_cents) used from public.phase5_credit_redemptions group by issuance_id) r on r.issuance_id=i.id
  where i.customer_id=p_customer_id and i.status='ACTIVE' and i.expires_at>now();
  applied:=least(p_ride_fare_cents+fee-waiver,available); total:=p_ride_fare_cents+fee-waiver-applied;
  if total<>p_expected_customer_total_cents then raise exception 'PHASE5_QUOTE_CHANGED'; end if;
  p_trip_payload:=p_trip_payload||jsonb_build_object('id',gen_random_uuid(),'customer_id',p_customer_id,
    'created_by',p_actor_id,'status',coalesce(p_trip_payload->>'status','requested'),'created_at',now(),
    'payment_method','cash','financial_version',0,'dispatch_cycle',0,'dispatch_sequence',0,'dispatch_state','idle',
    'phase5_policy_version',pol.version,'phase5_policy_effective_from',pol.effective_from,
    'phase5_ride_fare_cents',p_ride_fare_cents,'phase5_service_fee_cents',fee,
    'phase5_membership_waiver_cents',waiver,'phase5_credit_cents',applied,'phase5_customer_total_cents',total,
    'phase5_driver_fare_basis_cents',p_ride_fare_cents,'phase5_membership_id',membership.id,'phase5_booking_key',p_booking_key,
    'fare_amount',total::numeric/100,'final_fare',total::numeric/100,'estimated_fare',total::numeric/100);
  select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into p_trip_payload
  from jsonb_each(p_trip_payload) e join pg_catalog.pg_attribute a
    on a.attrelid='public.trips'::regclass and a.attname=e.key and a.attnum>0 and not a.attisdropped;
  insert into public.trips select (jsonb_populate_record(null::public.trips,p_trip_payload)).* returning * into created;
  remaining:=applied;
  for issue in
    select i.id,i.amount_cents-coalesce((select sum(r.amount_cents) from public.phase5_credit_redemptions r where r.issuance_id=i.id),0) balance
    from public.phase5_credit_issuances i where i.customer_id=p_customer_id and i.status='ACTIVE' and i.expires_at>now()
    order by i.expires_at,i.issued_at,i.id for update
  loop
    exit when remaining=0; if issue.balance<=0 then continue; end if;
    take:=least(remaining,issue.balance); redemption_key:='phase5:redemption:'||created.id||':'||issue.id;
    insert into public.phase5_credit_redemptions(issuance_id,customer_id,trip_id,amount_cents,idempotency_key)
    values(issue.id,p_customer_id,created.id,take,redemption_key); remaining:=remaining-take;
  end loop;
  if remaining<>0 then raise exception 'Credit availability changed'; end if;
  if applied>0 then
    a_credit:=public.phase1_ensure_financial_account(coalesce((select account_code from public.financial_accounts where owner_type='CUSTOMER' and owner_id=p_customer_id and account_category='CUSTOMER_PROMOTIONAL_CREDIT' and currency='ZAR'),'PHASE5:CUSTOMER:'||upper(p_customer_id::text)||':PROMO'),'CUSTOMER_PROMOTIONAL_CREDIT','CUSTOMER',p_customer_id,'CREDIT','ZAR');
    fare_credit:=least(applied,fee-waiver); driver_credit:=applied-fare_credit;
    entries:=entries||jsonb_build_array(jsonb_build_object('account_id',a_credit.id,'entry_side','DEBIT','amount_cents',applied));
    if fare_credit>0 then
      a_revenue:=public.phase1_ensure_financial_account(coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM' and owner_id is null and account_category='BOOKING_FEE_REVENUE' and currency='ZAR'),'PHASE5:SERVICE_FEE:REVENUE'),'BOOKING_FEE_REVENUE','PLATFORM',null,'CREDIT','ZAR');
      entries:=entries||jsonb_build_array(jsonb_build_object('account_id',a_revenue.id,'entry_side','CREDIT','amount_cents',fare_credit));
    end if;
    if driver_credit>0 then
      a_driver:=public.phase1_ensure_financial_account(coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM' and owner_id is null and account_category='DRIVER_EARNINGS_PAYABLE' and currency='ZAR'),'PHASE5:DRIVER_SUBSIDY:PAYABLE'),'DRIVER_EARNINGS_PAYABLE','PLATFORM',null,'CREDIT','ZAR');
      entries:=entries||jsonb_build_array(jsonb_build_object('account_id',a_driver.id,'entry_side','CREDIT','amount_cents',driver_credit));
    end if;
    payload:=created.id||':'||applied||':'||fare_credit||':'||driver_credit;
    posted:=public.phase1_post_financial_transaction('phase5:credit-redeem:'||created.id,
      encode(digest(convert_to(payload,'UTF8'),'sha256'),'hex'),'ADJUSTMENT','ADJUSTMENT',created.id,'ZAR','CUSTOMER',p_actor_id,now(),entries,
      jsonb_build_object('non_cash',true,'trip_id',created.id,'fare_credit_cents',fare_credit,'driver_subsidy_cents',driver_credit));
  end if;
  insert into public.phase5_audit_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('phase5-booking:'||created.id,'PHASE5_TRIP_BOOKED','TRIP',created.id,p_actor_id,
    jsonb_build_object('ride_fare_cents',p_ride_fare_cents,'service_fee_cents',fee,'waiver_cents',waiver,'credit_cents',applied,'customer_total_cents',total));
  return jsonb_build_object('trip',to_jsonb(created),'replayed',false,'credit_transaction_id',posted->>'transaction_id');
end $$;

create or replace function public.phase5_qualify_referral(p_trip_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.trips; rel public.phase5_referral_relationships; pol public.phase5_policies; a jsonb; b jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted server role required'; end if;
  select * into t from public.trips where id=p_trip_id for update;
  if not found or t.status<>'completed' or t.customer_id is null then raise exception 'Eligible completed trip required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('phase5-referral:'||t.customer_id::text,0));
  select * into rel from public.phase5_referral_relationships where referee_customer_id=t.customer_id for update;
  if rel.id is null then return jsonb_build_object('qualified',false,'reason','NO_REFERRAL','replayed',false); end if;
  if rel.status='QUALIFIED' then return jsonb_build_object('qualified',true,'relationship_id',rel.id,'replayed',true); end if;
  if exists(select 1 from public.trips where customer_id=t.customer_id and status='completed' and id<>t.id and completed_at<=t.completed_at) then
    return jsonb_build_object('qualified',false,'reason','NOT_FIRST_COMPLETED_RIDE','replayed',false); end if;
  select * into pol from public.phase5_policies where version=t.phase5_policy_version;
  if pol.version is null then return jsonb_build_object('qualified',false,'reason','LEGACY_TRIP','replayed',false); end if;
  a:=public.phase5_issue_credit(rel.referrer_customer_id,pol.referrer_reward_cents,'REFERRER_REWARD',rel.id,pol.version,
    'phase5:referrer:'||rel.id,p_actor_id,'First eligible completed ride referral reward');
  b:=public.phase5_issue_credit(rel.referee_customer_id,pol.referee_reward_cents,'REFEREE_REWARD',rel.id,pol.version,
    'phase5:referee:'||rel.id,p_actor_id,'First eligible completed ride referral reward');
  update public.phase5_referral_relationships set status='QUALIFIED',qualified_at=now(),qualifying_trip_id=t.id,policy_version=pol.version where id=rel.id;
  insert into public.phase5_audit_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('referral-qualified:'||rel.id,'REFERRAL_QUALIFIED','REFERRAL',rel.id,p_actor_id,
    jsonb_build_object('trip_id',t.id,'referrer_issuance_id',a->>'issuance_id','referee_issuance_id',b->>'issuance_id'));
  return jsonb_build_object('qualified',true,'relationship_id',rel.id,'referrer',a,'referee',b,'replayed',false);
end $$;

create or replace function public.phase5_post_service_fee(p_trip_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare t public.trips; v_fee bigint; v_credit_to_fee bigint; v_collected bigint;
  v_receivable public.financial_accounts; v_revenue public.financial_accounts; v_post jsonb; v_payload text;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted server role required'; end if;
  select * into t from public.trips where id=p_trip_id for update;
  if not found or t.status<>'completed' or t.phase5_policy_version is null or t.driver_id is null then
    raise exception 'Completed Phase 5 trip required';
  end if;
  v_fee:=greatest(0,t.phase5_service_fee_cents-t.phase5_membership_waiver_cents);
  v_credit_to_fee:=least(v_fee,t.phase5_credit_cents);
  v_collected:=v_fee-v_credit_to_fee;
  if v_collected=0 then
    return jsonb_build_object('trip_id',t.id,'amount_cents',0,'replayed',true);
  end if;
  v_receivable:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='DRIVER' and owner_id=t.driver_id and account_category='COMMISSION_RECEIVABLE' and currency='ZAR'),
      'PHASE5:DRIVER:'||upper(t.driver_id::text)||':SERVICE_FEE'),
    'COMMISSION_RECEIVABLE','DRIVER',t.driver_id,'DEBIT','ZAR');
  v_revenue:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM' and owner_id is null and account_category='BOOKING_FEE_REVENUE' and currency='ZAR'),
      'PHASE5:SERVICE_FEE:REVENUE'),
    'BOOKING_FEE_REVENUE','PLATFORM',null,'CREDIT','ZAR');
  v_payload:=t.id||':'||v_collected||':'||t.driver_id||':'||t.phase5_policy_version;
  v_post:=public.phase1_post_financial_transaction('phase5:service-fee:'||t.id,
    encode(digest(convert_to(v_payload,'UTF8'),'sha256'),'hex'),'BOOKING_FEE','ADJUSTMENT',t.id,
    'ZAR','SYSTEM',p_actor_id,now(),
    jsonb_build_array(
      jsonb_build_object('account_id',v_receivable.id,'entry_side','DEBIT','amount_cents',v_collected),
      jsonb_build_object('account_id',v_revenue.id,'entry_side','CREDIT','amount_cents',v_collected)),
    jsonb_build_object('trip_id',t.id,'driver_id',t.driver_id,'policy_version',t.phase5_policy_version,
      'cash_received_by_moovu',false,'gross_service_fee_cents',v_fee,'credit_applied_to_service_fee_cents',v_credit_to_fee));
  insert into public.phase5_audit_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('service-fee-posted:'||t.id,'SERVICE_FEE_POSTED','TRIP',t.id,p_actor_id,
    jsonb_build_object('amount_cents',v_collected,'financial_transaction_id',v_post->>'transaction_id','cash_received_by_moovu',false))
  on conflict(event_key) do nothing;
  return jsonb_build_object('trip_id',t.id,'amount_cents',v_collected,'financial_transaction_id',v_post->>'transaction_id','replayed',v_post->'replayed');
end $$;

revoke all on function public.phase5_issue_credit(uuid,bigint,text,uuid,text,text,uuid,text),
  public.phase5_reverse_credit(uuid,uuid,text),public.phase5_create_trip(uuid,uuid,text,jsonb,bigint,text,bigint),
  public.phase5_qualify_referral(uuid,uuid),public.phase5_post_service_fee(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.phase5_issue_credit(uuid,bigint,text,uuid,text,text,uuid,text),
  public.phase5_reverse_credit(uuid,uuid,text),public.phase5_create_trip(uuid,uuid,text,jsonb,bigint,text,bigint),
  public.phase5_qualify_referral(uuid,uuid),public.phase5_post_service_fee(uuid,uuid) to service_role;

-- Completion and referral qualification share one database transaction.
create or replace function public.phase05b_complete_trip(
  p_trip_id uuid,p_actor_id uuid,p_expected_driver_id uuid,p_mode text,p_otp text,p_reason text,p_note text,
  p_expected_financial_version bigint,p_expected_fare numeric,p_distance_audit text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare t public.trips%rowtype; v_role text; v_started timestamptz; v_min integer; v_elapsed integer;
        v_fare numeric(12,2); v_pct numeric(7,3); v_comm numeric(12,2); v_net numeric(12,2);
        v_wallet uuid; v_event uuid; v_replayed boolean:=false;
begin
  if p_mode not in ('otp','bypass','admin') then raise exception 'Invalid completion mode' using errcode='P0001'; end if;
  select * into t from public.trips where id=p_trip_id for update;
  if not found then raise exception 'Trip not found' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||coalesce(t.driver_id::text,''),0));
  if t.status='completed' then
    if exists(select 1 from public.moovu_business_events where event_key='trip-complete:'||t.id::text) then v_replayed:=true;
    else raise exception 'Completed trip has no authoritative completion event' using errcode='P0001'; end if;
  elsif t.status<>'ongoing' then raise exception 'Trip is not ongoing' using errcode='P0001'; end if;
  if t.driver_id is null or (p_expected_driver_id is not null and t.driver_id<>p_expected_driver_id) then
    raise exception 'Trip driver ownership changed' using errcode='P0001'; end if;
  select role into v_role from public.profiles where id=p_actor_id;
  if p_mode='admin' then
    if v_role not in ('owner','admin','dispatcher','support') then raise exception 'Admin completion not authorized' using errcode='P0001'; end if;
    if length(trim(coalesce(p_note,'')))<3 then raise exception 'Admin completion note required' using errcode='P0001'; end if;
  else
    if not exists(select 1 from public.driver_accounts where user_id=p_actor_id and driver_id=t.driver_id) then
      raise exception 'Driver completion not authorized' using errcode='P0001'; end if;
  end if;
  if v_replayed then
    return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'driver_id',t.driver_id,
      'fare_amount',t.fare_amount,'commission_pct',t.commission_pct,'commission_amount',t.commission_amount,
      'driver_net',t.driver_net_earnings,'replayed',true);
  end if;
  if not coalesce(t.start_otp_verified,false) then raise exception 'Start OTP was not verified' using errcode='P0001'; end if;
  if p_mode='otp' and (t.end_otp is null or trim(coalesce(p_otp,''))<>t.end_otp) then raise exception 'Incorrect End OTP' using errcode='P0001'; end if;
  if p_mode='bypass' and coalesce(p_reason,'') not in ('Customer phone unavailable/dead','Customer unable to access OTP','Connectivity issue','Customer left vehicle','Other') then
    raise exception 'Valid End OTP bypass reason required' using errcode='P0001'; end if;
  if p_mode='bypass' and p_reason='Other' and length(trim(coalesce(p_note,'')))<3 then raise exception 'Bypass note required' using errcode='P0001'; end if;
  v_started:=coalesce(t.trip_started_at,(select max(created_at) from public.trip_events where trip_id=t.id and event_type='trip_started'));
  if v_started is null then raise exception 'Trip start record missing' using errcode='P0001'; end if;
  v_elapsed:=floor(extract(epoch from(now()-v_started))); v_min:=least(600,greatest(120,round(coalesce(t.duration_min,0)*12)::integer));
  if v_elapsed<v_min then raise exception 'Minimum trip duration has not elapsed' using errcode='P0001'; end if;
  if t.financial_version<>p_expected_financial_version then raise exception 'Trip fare changed during completion' using errcode='P0001'; end if;
  v_fare:=case when t.phase5_policy_version is not null then t.phase5_driver_fare_basis_cents::numeric/100 else round(coalesce(t.final_fare,t.fare_amount,t.estimated_fare,t.original_fare),2) end;
  if v_fare<=0 or abs(v_fare-p_expected_fare)>0.009 then raise exception 'Authoritative fare mismatch' using errcode='P0001'; end if;
  v_pct:=case when lower(coalesce(t.ride_option,'')) in ('group','xl','moovu_go_xl') then 12
              when lower(coalesce(t.ride_option,'')) in ('go','standard','moovu_go') then 10 else 9.5 end;
  v_comm:=round(v_fare*v_pct/100,2); v_net:=round(v_fare-v_comm,2);
  insert into public.driver_wallets(driver_id,balance_due,total_commission,total_driver_net,total_trips_completed,account_status,updated_at)
    values(t.driver_id,0,0,0,0,'settled',now()) on conflict(driver_id) do nothing;
  select id into v_wallet from public.driver_wallets where driver_id=t.driver_id for update;
  insert into public.driver_wallet_transactions(driver_id,wallet_id,trip_id,tx_type,amount,direction,description,meta,created_by)
    values(t.driver_id,v_wallet,t.id,'commission',v_comm,'debit',v_pct||'% MOOVU commission charged on trip '||t.id,
      jsonb_build_object('fare_amount',t.fare_amount,'driver_fare_basis',v_fare,'commission_pct',v_pct,'driver_net',v_net,'contract_version',public.phase05b_contract_version()),p_actor_id);
  update public.trips set status='completed',completed_at=now(),fare_amount=case when phase5_policy_version is null then v_fare else fare_amount end,final_fare=case when phase5_policy_version is null then v_fare else final_fare end,
    commission_pct=v_pct,commission_amount=v_comm,driver_net_earnings=v_net,end_otp_verified=(p_mode='otp'),
    completed_without_end_otp=(p_mode='bypass'),end_otp_bypass_reason=case when p_mode='bypass' then p_reason else null end,
    end_otp_bypass_note=case when p_mode='bypass' then nullif(trim(p_note),'') else null end,
    end_otp_bypassed_by=case when p_mode='bypass' then p_actor_id else null end,
    end_otp_bypassed_at=case when p_mode='bypass' then now() else null end,
    completed_by=case when p_mode='admin' then 'admin' else 'driver' end,
    admin_completion_reason=case when p_mode='admin' then p_note else null end,
    admin_completion_note=case when p_mode='admin' then p_note else null end,
    fare_finalized_at=now(),fare_adjustment_reason=case when coalesce(fare_adjustment_amount,0)>0 then 'active_stop_added' else 'finalized_without_adjustment' end
    where id=t.id;
  if t.phase5_policy_version is not null then
    perform public.phase5_post_service_fee(t.id,p_actor_id);
    perform public.phase5_qualify_referral(t.id,p_actor_id);
  end if;
  update public.drivers set busy=false where id=t.driver_id;
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
    values(t.id,'trip_completed',coalesce(p_distance_audit,'Trip completed.')||' Mode: '||p_mode,'ongoing','completed',p_actor_id);
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
    values('trip-complete:'||t.id::text,'trip_completed','trip',t.id,p_actor_id,
      jsonb_build_object('driver_id',t.driver_id,'fare_amount',t.fare_amount,'driver_fare_basis',v_fare,'commission_pct',v_pct,'commission_amount',v_comm,'mode',p_mode))
    returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'trip_completed',jsonb_build_object('trip_id',t.id,'driver_id',t.driver_id,'fare_amount',t.fare_amount,'driver_fare_basis',v_fare));
  perform public.phase05b_refresh_driver_wallet(t.driver_id);
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'driver_id',t.driver_id,
    'fare_amount',t.fare_amount,'driver_fare_basis',v_fare,'commission_pct',v_pct,'commission_amount',v_comm,'driver_net',v_net,'replayed',false);
end $$;

-- Phase 2 stays SHADOW and observes the same snapshotted Driver basis.
create or replace function public.phase2_post_trip_commission(p_trip_id uuid,p_actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_policy public.phase2_finance_policy; v_trip public.trips; v_debt public.financial_accounts;
        v_revenue public.financial_accounts; v_fare_cents bigint; v_commission_cents bigint;
        v_entries jsonb; v_payload jsonb; v_hash text; v_result jsonb; v_legacy_cents bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into strict v_policy from public.phase2_finance_policy where policy_key='phase2-driver-finance';
  if v_policy.mode='OFF' then raise exception 'Phase 2 is OFF'; end if;
  select * into strict v_trip from public.trips where id=p_trip_id for update;
  if v_trip.status<>'completed' or v_trip.driver_id is null then raise exception 'Completed assigned trip required'; end if;
  if v_trip.commission_locked_at is null or v_trip.commission_policy_id<>v_policy.id
    or v_trip.commission_basis_points is null then raise exception 'Valid locked commission snapshot required'; end if;
  v_fare_cents:=case when v_trip.phase5_policy_version is not null then v_trip.phase5_driver_fare_basis_cents else round(coalesce(v_trip.final_fare,v_trip.fare_amount,0)*100)::bigint end;
  if v_fare_cents<=0 then raise exception 'Positive final fare required'; end if;
  v_commission_cents:=(v_fare_cents*v_trip.commission_basis_points+5000)/10000;
  if v_commission_cents<=0 then raise exception 'Positive commission required'; end if;
  v_debt:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='DRIVER'
      and owner_id=v_trip.driver_id and account_category='DRIVER_COMMISSION_DEBT' and currency='ZAR'),
      'DRIVER:'||upper(v_trip.driver_id::text)||':COMMISSION_DEBT:ZAR'),'DRIVER_COMMISSION_DEBT',
    'DRIVER',v_trip.driver_id,'DEBIT','ZAR');
  v_revenue:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM'
      and owner_id is null and account_category='COMMISSION_REVENUE' and currency='ZAR'),
      'PLATFORM:COMMISSION_REVENUE:ZAR'),'COMMISSION_REVENUE','PLATFORM',null,'CREDIT','ZAR');
  v_entries:=jsonb_build_array(
    jsonb_build_object('account_id',v_debt.id,'entry_side','DEBIT','amount_cents',v_commission_cents),
    jsonb_build_object('account_id',v_revenue.id,'entry_side','CREDIT','amount_cents',v_commission_cents));
  v_payload:=jsonb_build_object('trip_id',v_trip.id,'driver_id',v_trip.driver_id,'fare_cents',v_fare_cents,
    'commission_basis_points',v_trip.commission_basis_points,'commission_cents',v_commission_cents,
    'rounding_version',v_trip.commission_rounding_version);
  v_hash:=encode(pg_catalog.sha256(convert_to(v_payload::text,'UTF8')),'hex');
  v_result:=public.phase1_post_financial_transaction('trip_commission:'||v_trip.id::text,v_hash,
    'TRIP_FINANCIAL_COMPLETION','TRIP',v_trip.id,'ZAR','SYSTEM',p_actor_id,now(),v_entries,v_payload,null);
  v_legacy_cents:=round(coalesce(v_trip.commission_amount,0)*100)::bigint;
  insert into public.phase2_shadow_reconciliations(operation_key,source_type,source_id,driver_id,
    legacy_amount_cents,ledger_amount_cents,parity,details)
  values('trip_commission:'||v_trip.id::text,'TRIP',v_trip.id,v_trip.driver_id,v_legacy_cents,
    v_commission_cents,v_legacy_cents=v_commission_cents,v_payload)
  on conflict(operation_key) do update set legacy_amount_cents=excluded.legacy_amount_cents,
    ledger_amount_cents=excluded.ledger_amount_cents,parity=excluded.parity,details=excluded.details;
  return v_result||jsonb_build_object('contract_version',public.phase2_contract_version(),
    'trip_id',v_trip.id,'commission_cents',v_commission_cents,'legacy_commission_cents',v_legacy_cents,
    'parity',v_legacy_cents=v_commission_cents);
end $$;

commit;
