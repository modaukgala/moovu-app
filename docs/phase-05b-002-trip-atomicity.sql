-- MOOVU Phase 0.5B - atomic completion, cancellation/no-show evidence, assignment safeguards
-- REVIEW ONLY / NOT APPLIED / dependent on 001 and successful read-only preflight.
begin;

alter table public.trips
  add column if not exists financial_version bigint not null default 0,
  add column if not exists arrival_evidence_at timestamptz,
  add column if not exists arrival_driver_lat numeric(10,7),
  add column if not exists arrival_driver_lng numeric(10,7),
  add column if not exists arrival_pickup_lat numeric(10,7),
  add column if not exists arrival_pickup_lng numeric(10,7),
  add column if not exists arrival_distance_m numeric(12,2),
  add column if not exists arrival_location_age_seconds integer,
  add column if not exists arrival_evidence_qualified boolean,
  add column if not exists arrival_evidence_version text,
  add column if not exists cancellation_reason_details text,
  add column if not exists cancellation_status_at_request text,
  add column if not exists cancelled_within_free_window boolean default false;

-- Phase 0 cancellation and no-show compensation is represented as a credit
-- against commission owed. Preserve every production type and add only the
-- required hardened type before any RPC below can write it.
do $$ begin
  if exists (
    select 1 from public.driver_wallet_transactions
    where tx_type is not null
      and tx_type not in ('commission','payment','adjustment','cancellation_credit')
  ) then
    raise exception 'Unsupported wallet transaction type requires review before Phase 0.5B';
  end if;
  alter table public.driver_wallet_transactions
    drop constraint if exists driver_wallet_transactions_tx_type_check;
  alter table public.driver_wallet_transactions
    add constraint driver_wallet_transactions_tx_type_check
    check (tx_type in ('commission','payment','adjustment','cancellation_credit'));
end $$;

create or replace function public.phase05b_protect_trip_finance()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.status in ('completed','cancelled') and (
    new.fare_amount is distinct from old.fare_amount or new.final_fare is distinct from old.final_fare or
    new.commission_pct is distinct from old.commission_pct or new.commission_amount is distinct from old.commission_amount or
    new.driver_net_earnings is distinct from old.driver_net_earnings or new.driver_id is distinct from old.driver_id
  ) then raise exception 'Terminal trip financial history is immutable' using errcode='P0001'; end if;
  if new.fare_amount is distinct from old.fare_amount or new.final_fare is distinct from old.final_fare or
     new.driver_id is distinct from old.driver_id then new.financial_version:=old.financial_version+1; end if;
  return new;
end $$;
drop trigger if exists phase05b_protect_trip_finance_trigger on public.trips;
create trigger phase05b_protect_trip_finance_trigger before update on public.trips
for each row execute function public.phase05b_protect_trip_finance();

do $$ begin
  if exists(select 1 from public.driver_wallet_transactions where trip_id is not null and tx_type='commission'
    group by trip_id having count(*)>1) then raise exception 'Duplicate commission rows require reconciliation'; end if;
  if exists(select 1 from public.trip_cancellation_fees group by trip_id having count(*)>1) then
    raise exception 'Duplicate cancellation/no-show fee rows require reconciliation'; end if;
end $$;
create unique index if not exists driver_wallet_transactions_trip_commission_uidx
  on public.driver_wallet_transactions(trip_id) where trip_id is not null and tx_type='commission';
create unique index if not exists trip_cancellation_fees_trip_business_event_uidx
  on public.trip_cancellation_fees(trip_id);

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
  v_fare:=round(coalesce(t.final_fare,t.fare_amount,t.estimated_fare,t.original_fare),2);
  if v_fare<=0 or abs(v_fare-p_expected_fare)>0.009 then raise exception 'Authoritative fare mismatch' using errcode='P0001'; end if;
  v_pct:=case when lower(coalesce(t.ride_option,'')) in ('group','xl','moovu_go_xl') then 12
              when lower(coalesce(t.ride_option,'')) in ('go','standard','moovu_go') then 10 else 9.5 end;
  v_comm:=round(v_fare*v_pct/100,2); v_net:=round(v_fare-v_comm,2);
  insert into public.driver_wallets(driver_id,balance_due,total_commission,total_driver_net,total_trips_completed,account_status,updated_at)
    values(t.driver_id,0,0,0,0,'settled',now()) on conflict(driver_id) do nothing;
  select id into v_wallet from public.driver_wallets where driver_id=t.driver_id for update;
  insert into public.driver_wallet_transactions(driver_id,wallet_id,trip_id,tx_type,amount,direction,description,meta,created_by)
    values(t.driver_id,v_wallet,t.id,'commission',v_comm,'debit',v_pct||'% MOOVU commission charged on trip '||t.id,
      jsonb_build_object('fare_amount',v_fare,'commission_pct',v_pct,'driver_net',v_net,'contract_version',public.phase05b_contract_version()),p_actor_id);
  update public.trips set status='completed',completed_at=now(),fare_amount=v_fare,final_fare=v_fare,
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
  update public.drivers set busy=false where id=t.driver_id;
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
    values(t.id,'trip_completed',coalesce(p_distance_audit,'Trip completed.')||' Mode: '||p_mode,'ongoing','completed',p_actor_id);
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
    values('trip-complete:'||t.id::text,'trip_completed','trip',t.id,p_actor_id,
      jsonb_build_object('driver_id',t.driver_id,'fare_amount',v_fare,'commission_pct',v_pct,'commission_amount',v_comm,'mode',p_mode))
    returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'trip_completed',jsonb_build_object('trip_id',t.id,'driver_id',t.driver_id,'fare_amount',v_fare));
  perform public.phase05b_refresh_driver_wallet(t.driver_id);
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'driver_id',t.driver_id,
    'fare_amount',v_fare,'commission_pct',v_pct,'commission_amount',v_comm,'driver_net',v_net,'replayed',false);
end $$;

create or replace function public.phase05b_cancel_trip(
  p_trip_id uuid,p_customer_id uuid,p_actor_id uuid,p_reason text,p_reason_details text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare t public.trips%rowtype; v_free boolean; v_fee numeric(12,2); v_driver numeric(12,2); v_moovu numeric(12,2);
        v_type text; v_policy text; v_wallet uuid; v_event uuid; v_fee_id uuid; v_offered uuid[];
begin
  select * into t from public.trips where id=p_trip_id for update;
  if not found or t.customer_id<>p_customer_id then raise exception 'Trip not found' using errcode='P0001'; end if;
  if not exists(select 1 from public.customers where id=p_customer_id and auth_user_id=p_actor_id) then
    -- Column names vary in older schemas; production preflight must confirm this contract before activation.
    raise exception 'Customer cancellation not authorized' using errcode='P0001';
  end if;
  if t.status='cancelled' and exists(select 1 from public.moovu_business_events where event_key='trip-cancel:'||t.id::text) then
    select id into v_fee_id from public.trip_cancellation_fees where trip_id=t.id;
    return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'driver_id',t.driver_id,
      'fee_amount',coalesce(t.cancellation_fee_amount,0),'driver_amount',coalesce(t.cancellation_driver_amount,0),
      'moovu_amount',coalesce(t.cancellation_moovu_amount,0),'policy_code',t.cancellation_policy_code,'replayed',true);
  end if;
  if t.status not in ('requested','offered','assigned','arrived') then raise exception 'Trip cannot be cancelled in its current state' using errcode='P0001'; end if;
  if t.driver_id is not null then perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||t.driver_id::text,0)); end if;
  v_free:=now()<t.created_at+interval '3 minutes';
  if v_free then v_fee:=0;v_driver:=0;v_moovu:=0;v_type:='free_cancel';v_policy:='free_cancel';
  elsif lower(coalesce(t.ride_option,'')) in ('group','xl','moovu_go_xl') then
    v_fee:=30;v_driver:=case when t.status in ('assigned','arrived') then 20 else 0 end;v_moovu:=v_fee-v_driver;
    v_type:='late_cancel';v_policy:=case when v_driver>0 then 'late_cancel_driver_dispatched' else 'late_cancel_unassigned' end;
  else
    v_fee:=20;v_driver:=case when t.status in ('assigned','arrived') then 13 else 0 end;v_moovu:=v_fee-v_driver;
    v_type:='late_cancel';v_policy:=case when v_driver>0 then 'late_cancel_driver_dispatched' else 'late_cancel_unassigned' end;
  end if;
  insert into public.trip_cancellation_fees(trip_id,customer_id,driver_id,fee_type,fee_amount,driver_amount,moovu_amount,reason,created_by)
    values(t.id,t.customer_id,t.driver_id,v_type,v_fee,v_driver,v_moovu,
      case when p_reason='Other' then p_reason||': '||coalesce(p_reason_details,'') else p_reason end,p_actor_id)
    returning id into v_fee_id;
  update public.trips set status='cancelled',cancel_reason=p_reason,cancellation_reason=p_reason,
    cancellation_reason_details=case when p_reason='Other' then nullif(trim(p_reason_details),'') else null end,
    cancellation_status_at_request=t.status,cancelled_within_free_window=v_free,cancellation_type=v_type,
    cancelled_by='customer',cancelled_at=now(),cancellation_fee_amount=v_fee,cancellation_driver_amount=v_driver,
    cancellation_moovu_amount=v_moovu,cancellation_policy_code=v_policy where id=t.id;
  select array_agg(distinct driver_id) into v_offered from public.driver_trip_offers
    where trip_id=t.id and status in ('pending','shown');
  update public.driver_trip_offers set status='cancelled',cancelled_at=now(),responded_at=now(),updated_at=now()
    where trip_id=t.id and status in ('pending','shown');
  if t.driver_id is not null then update public.drivers set busy=false where id=t.driver_id; end if;
  if t.driver_id is not null and v_driver>0 then
    insert into public.driver_wallets(driver_id,balance_due,total_commission,total_driver_net,total_trips_completed,account_status,updated_at)
      values(t.driver_id,0,0,0,0,'settled',now()) on conflict(driver_id) do nothing;
    select id into v_wallet from public.driver_wallets where driver_id=t.driver_id for update;
    insert into public.driver_wallet_transactions(driver_id,wallet_id,trip_id,tx_type,amount,direction,description,meta,created_by)
      values(t.driver_id,v_wallet,t.id,'cancellation_credit',v_driver,'credit','Customer cancellation credit for trip '||t.id,
        jsonb_build_object('source','trip_cancellation_fee','fee_id',v_fee_id,'reduces_commission_owed',true,
          'economic_policy','existing_commission_offset','contract_version',public.phase05b_contract_version()),
        case when exists(select 1 from public.profiles where id=p_actor_id) then p_actor_id else null end);
    perform public.phase05b_refresh_driver_wallet(t.driver_id);
  end if;
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
    values(t.id,'trip_cancelled','Customer cancellation. Fee R'||v_fee||'. Driver offset R'||v_driver||'.',t.status,'cancelled',
      case when exists(select 1 from public.profiles where id=p_actor_id) then p_actor_id else null end);
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
    values('trip-cancel:'||t.id::text,'trip_cancelled','trip',t.id,p_actor_id,
      jsonb_build_object('fee_id',v_fee_id,'driver_id',t.driver_id,'fee_amount',v_fee,'driver_amount',v_driver,'moovu_amount',v_moovu))
    returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'trip_cancelled',jsonb_build_object('trip_id',t.id,'driver_id',t.driver_id,'customer_id',t.customer_id));
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'driver_id',t.driver_id,
    'fee_amount',v_fee,'driver_amount',v_driver,'moovu_amount',v_moovu,'policy_code',v_policy,
    'offered_driver_ids',coalesce(to_jsonb(v_offered),'[]'::jsonb),'replayed',false);
end $$;

create or replace function public.phase05b_mark_arrived(
 p_trip_id uuid,p_driver_id uuid,p_actor_id uuid,p_driver_lat numeric,p_driver_lng numeric,p_location_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare t public.trips%rowtype; v_distance numeric(12,2); v_age integer; v_qualified boolean; v_event uuid;
begin
  select * into t from public.trips where id=p_trip_id for update;
  if not found or t.driver_id<>p_driver_id then raise exception 'Trip assignment changed' using errcode='P0001'; end if;
  if not exists(select 1 from public.driver_accounts where user_id=p_actor_id and driver_id=p_driver_id) then
    raise exception 'Arrival not authorized' using errcode='P0001'; end if;
  if t.status='arrived' and exists(select 1 from public.moovu_business_events where event_key='trip-arrived:'||t.id::text) then
    return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,
      'distance_m',t.arrival_distance_m,'location_age_seconds',t.arrival_location_age_seconds,
      'no_show_evidence_qualified',coalesce(t.arrival_evidence_qualified,false),'replayed',true);
  end if;
  if t.status<>'assigned' then raise exception 'Only assigned trips can be marked arrived' using errcode='P0001'; end if;
  v_age:=floor(extract(epoch from(now()-p_location_at)));
  if p_location_at>now()+interval '5 seconds' then v_age:=-1; end if;
  if p_driver_lat is null or p_driver_lng is null or t.pickup_lat is null or t.pickup_lng is null then
    v_distance:=null;v_qualified:=false;
  else
    v_distance:=round((6371000*2*asin(sqrt(power(sin(radians((t.pickup_lat-p_driver_lat)/2)),2)+
      cos(radians(p_driver_lat))*cos(radians(t.pickup_lat))*power(sin(radians((t.pickup_lng-p_driver_lng)/2)),2))))::numeric,2);
    v_qualified:=v_distance<=20 and v_age between 0 and 90;
  end if;
  update public.trips set status='arrived',driver_arrived_at=now(),arrival_evidence_at=now(),
    arrival_driver_lat=p_driver_lat,arrival_driver_lng=p_driver_lng,arrival_pickup_lat=t.pickup_lat,arrival_pickup_lng=t.pickup_lng,
    arrival_distance_m=v_distance,arrival_location_age_seconds=v_age,arrival_evidence_qualified=v_qualified,
    arrival_evidence_version='phase-05b-v1' where id=t.id;
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
    values(t.id,'driver_arrived','Arrival recorded. Distance m: '||coalesce(v_distance::text,'unavailable')||
      '. No-show evidence qualified: '||v_qualified::text,'assigned','arrived',p_actor_id);
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
    values('trip-arrived:'||t.id::text,'trip_arrived','trip',t.id,p_actor_id,
      jsonb_build_object('trip_id',t.id,'driver_id',t.driver_id,'customer_id',t.customer_id,'distance_m',v_distance))
    returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'trip_arrived',jsonb_build_object('trip_id',t.id,'driver_id',t.driver_id,'customer_id',t.customer_id));
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'distance_m',v_distance,
    'location_age_seconds',v_age,'no_show_evidence_qualified',v_qualified,'replayed',false);
end $$;

create or replace function public.phase05b_mark_no_show(p_trip_id uuid,p_driver_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare t public.trips%rowtype; v_fee numeric(12,2);v_driver numeric(12,2);v_moovu numeric(12,2);
        v_wallet uuid;v_event uuid;v_fee_id uuid;
begin
  select * into t from public.trips where id=p_trip_id for update;
  if not found or t.driver_id<>p_driver_id then raise exception 'Trip assignment changed' using errcode='P0001'; end if;
  if not exists(select 1 from public.driver_accounts where user_id=p_actor_id and driver_id=p_driver_id) then
    raise exception 'No-show not authorized' using errcode='P0001';end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||p_driver_id::text,0));
  if t.status='cancelled' and exists(select 1 from public.moovu_business_events where event_key='trip-no-show:'||t.id::text) then
    return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,
      'fee_amount',t.cancellation_fee_amount,'driver_amount',t.cancellation_driver_amount,'moovu_amount',t.cancellation_moovu_amount,'replayed',true);
  end if;
  if t.status<>'arrived' then raise exception 'Only an arrived trip can be marked no-show' using errcode='P0001';end if;
  if not coalesce(t.arrival_evidence_qualified,false) then raise exception 'Arrival evidence is not eligible for automatic no-show compensation' using errcode='P0001';end if;
  if t.driver_arrived_at is null or now()<t.driver_arrived_at+interval '5 minutes' then raise exception 'No-show waiting period has not elapsed' using errcode='P0001';end if;
  if lower(coalesce(t.ride_option,'')) in ('group','xl','moovu_go_xl') then v_fee:=40;v_driver:=30;v_moovu:=10;
  else v_fee:=30;v_driver:=22;v_moovu:=8;end if;
  insert into public.trip_cancellation_fees(trip_id,customer_id,driver_id,fee_type,fee_amount,driver_amount,moovu_amount,reason,created_by)
    values(t.id,t.customer_id,t.driver_id,'no_show',v_fee,v_driver,v_moovu,'Customer no-show',p_actor_id) returning id into v_fee_id;
  update public.trips set status='cancelled',cancel_reason='Customer no-show',cancellation_reason='Customer no-show',
    cancellation_type='no_show',cancelled_by='driver',cancelled_at=now(),cancellation_fee_amount=v_fee,
    cancellation_driver_amount=v_driver,cancellation_moovu_amount=v_moovu,cancellation_policy_code='customer_no_show',
    no_show_eligible_at=t.driver_arrived_at+interval '5 minutes' where id=t.id;
  update public.drivers set busy=false where id=t.driver_id;
  insert into public.driver_wallets(driver_id,balance_due,total_commission,total_driver_net,total_trips_completed,account_status,updated_at)
    values(t.driver_id,0,0,0,0,'settled',now()) on conflict(driver_id) do nothing;
  select id into v_wallet from public.driver_wallets where driver_id=t.driver_id for update;
  insert into public.driver_wallet_transactions(driver_id,wallet_id,trip_id,tx_type,amount,direction,description,meta,created_by)
    values(t.driver_id,v_wallet,t.id,'cancellation_credit',v_driver,'credit','Customer no-show credit for trip '||t.id,
      jsonb_build_object('source','trip_cancellation_fee','fee_id',v_fee_id,'reduces_commission_owed',true,
        'economic_policy','existing_commission_offset','contract_version',public.phase05b_contract_version()),p_actor_id);
  perform public.phase05b_refresh_driver_wallet(t.driver_id);
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
    values(t.id,'customer_no_show','No-show fee R'||v_fee||'. Driver commission offset R'||v_driver||'.','arrived','cancelled',p_actor_id);
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
    values('trip-no-show:'||t.id::text,'customer_no_show','trip',t.id,p_actor_id,
      jsonb_build_object('fee_id',v_fee_id,'driver_id',t.driver_id,'fee_amount',v_fee,'driver_amount',v_driver,'moovu_amount',v_moovu))
    returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'customer_no_show',jsonb_build_object('trip_id',t.id,'driver_id',t.driver_id,'customer_id',t.customer_id));
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,
    'fee_amount',v_fee,'driver_amount',v_driver,'moovu_amount',v_moovu,'replayed',false);
end $$;

create or replace function public.phase05b_cancel_trip_operational(p_trip_id uuid,p_actor_id uuid,p_actor_kind text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.trips%rowtype;v_role text;v_event uuid;v_key text:='trip-operational-cancel:'||p_trip_id::text;
begin
 perform pg_advisory_xact_lock(hashtextextended('trip:'||p_trip_id::text,0));
 select * into t from public.trips where id=p_trip_id for update;
 if not found then raise exception 'Trip not found' using errcode='P0001';end if;
 if p_actor_kind='admin' then select role into v_role from public.profiles where id=p_actor_id;
   if v_role not in ('owner','admin','dispatcher','support') then raise exception 'Admin cancellation not authorized' using errcode='P0001';end if;
 elsif p_actor_kind='driver' then
   if not exists(select 1 from public.driver_accounts where user_id=p_actor_id and driver_id=t.driver_id) then raise exception 'Driver cancellation not authorized' using errcode='P0001';end if;
 else raise exception 'Invalid cancellation actor' using errcode='P0001';end if;
 if t.status='cancelled' then return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'driver_id',t.driver_id,'replayed',true);end if;
 if t.status='completed' or (p_actor_kind='driver' and t.status not in ('assigned','arrived')) then raise exception 'Trip cannot be cancelled in its current state' using errcode='P0001';end if;
 update public.trips set status='cancelled',cancel_reason=p_reason,cancellation_reason=p_reason,cancellation_type=p_actor_kind||'_cancelled',
  cancelled_by=p_actor_kind,cancelled_at=now(),cancellation_fee_amount=0,cancellation_driver_amount=0,cancellation_moovu_amount=0,
  cancellation_policy_code=p_actor_kind||'_cancelled',offer_status=null,offer_expires_at=null where id=t.id;
 update public.driver_trip_offers set status='cancelled',cancelled_at=coalesce(cancelled_at,now()),
  responded_at=coalesce(responded_at,now()),updated_at=now() where trip_id=t.id and status in ('pending','shown');
 if t.driver_id is not null then update public.drivers set busy=false where id=t.driver_id;end if;
 insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
 values(t.id,'trip_cancelled_'||p_actor_kind,'Trip cancelled by '||p_actor_kind||'. Reason: '||p_reason,t.status,'cancelled',p_actor_id);
 insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
 values(v_key,'trip_cancelled_'||p_actor_kind,'trip',t.id,p_actor_id,jsonb_build_object('trip_id',t.id,'driver_id',t.driver_id,'reason',p_reason)) returning id into v_event;
 insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
 values(v_event,'trip_cancelled_'||p_actor_kind,jsonb_build_object('trip_id',t.id,'driver_id',t.driver_id,'reason',p_reason));
 return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'driver_id',t.driver_id,'replayed',false);
end $$;

revoke all on function public.phase05b_complete_trip(uuid,uuid,uuid,text,text,text,text,bigint,numeric,text) from public,anon,authenticated;
revoke all on function public.phase05b_cancel_trip(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.phase05b_mark_arrived(uuid,uuid,uuid,numeric,numeric,timestamptz) from public,anon,authenticated;
revoke all on function public.phase05b_mark_no_show(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase05b_complete_trip(uuid,uuid,uuid,text,text,text,text,bigint,numeric,text) to service_role;
grant execute on function public.phase05b_cancel_trip(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.phase05b_mark_arrived(uuid,uuid,uuid,numeric,numeric,timestamptz) to service_role;
grant execute on function public.phase05b_mark_no_show(uuid,uuid,uuid) to service_role;
revoke all on function public.phase05b_cancel_trip_operational(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.phase05b_cancel_trip_operational(uuid,uuid,text,text) to service_role;

commit;

-- Existing-data blockers: duplicate fee/commission rows, absent completion or
-- bypass columns, and incompatible UUID/numeric types. Do not repair silently.
-- Rollback: trigger/function may be dropped before activation; after financial
-- events exist, preserve records and use a forward corrective migration.
