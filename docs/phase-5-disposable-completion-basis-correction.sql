begin;
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
  if t.phase5_policy_version is not null then perform public.phase5_qualify_referral(t.id,p_actor_id); end if;
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
