-- Phase 4B multi-policy correction. Applies only to trips created after the first Phase 4 policy effective time.
begin;
create or replace function public.phase4b_quote_customer_cancellation(p_trip_id uuid,p_customer_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.trips; p public.phase4_policies;v_now timestamptz;v_terms jsonb;v_quote public.phase4b_cancellation_quotes;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required';end if;
  select * into t from public.trips where id=p_trip_id for update;
  if not found or t.customer_id is distinct from p_customer_id or not exists
    (select 1 from public.customers where id=p_customer_id and auth_user_id=p_actor_id) then
    raise exception 'Trip not found or Customer unauthorized';end if;
  if t.status not in ('requested','offered','assigned','arrived') then raise exception 'Trip not cancellable';end if;
  v_now:=clock_timestamp();
  select * into p from public.phase4_policies where effective_from<=v_now order by effective_from desc limit 1;
  if not found then raise exception 'Phase 4 policy is not active';end if;
  if t.created_at<(select min(effective_from) from public.phase4_policies) then raise exception 'Trip predates active Phase 4 policy';end if;
  v_terms:=public.phase4b_cancellation_terms(t,p,v_now);
  insert into public.phase4b_cancellation_quotes(trip_id,customer_id,policy_version,issued_at,expires_at,terms)
    values(t.id,p_customer_id,p.version,v_now,v_now+interval '30 seconds',v_terms) returning * into v_quote;
  return jsonb_build_object('quote_id',v_quote.id,'issued_at',v_quote.issued_at,
    'expires_at',v_quote.expires_at,'authoritative_at',v_now,'terms',v_terms);
end $$;
create or replace function public.phase4b_cancel_customer_trip(p_trip_id uuid,p_customer_id uuid,p_actor_id uuid,
  p_quote_id uuid,p_reason text,p_reason_details text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.trips;p public.phase4_policies;q public.phase4b_cancellation_quotes;
  v_now timestamptz;v_terms jsonb;v_assessment uuid;v_event uuid;v_offered uuid[];v_fee bigint;v_driver bigint;v_moovu bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required';end if;
  select * into t from public.trips where id=p_trip_id for update;
  if not found or t.customer_id is distinct from p_customer_id or not exists
    (select 1 from public.customers where id=p_customer_id and auth_user_id=p_actor_id) then
    raise exception 'Trip not found or Customer unauthorized';end if;
  if t.status='cancelled' and exists(select 1 from public.moovu_business_events
    where event_key='phase4:customer-cancel:'||t.id) then
    select id into v_assessment from public.phase4_fee_assessments where trip_id=t.id;
    return jsonb_build_object('trip_id',t.id,'replayed',true,'assessment_id',v_assessment,
      'fee_cents',coalesce((t.cancellation_fee_amount*100)::bigint,0));
  end if;
  if t.status not in ('requested','offered','assigned','arrived') then raise exception 'Trip not cancellable';end if;
  select * into q from public.phase4b_cancellation_quotes where id=p_quote_id and trip_id=t.id
    and customer_id=p_customer_id for update;
  if not found then raise exception 'Authoritative quote required';end if;
  v_now:=clock_timestamp();
  select * into p from public.phase4_policies where effective_from<=v_now order by effective_from desc limit 1;
  if not found or t.created_at<(select min(effective_from) from public.phase4_policies) then raise exception 'Trip predates active Phase 4 policy';end if;
  perform public.phase4b_assert_owner_policy(p);
  v_terms:=public.phase4b_cancellation_terms(t,p,v_now);
  if q.expires_at<v_now or q.terms is distinct from v_terms or q.policy_version<>p.version then
    return jsonb_build_object('requires_reconfirmation',true,'trip_id',t.id);
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Reason required';end if;
  v_fee:=(v_terms->>'fee_cents')::bigint;v_driver:=(v_terms->>'driver_cents')::bigint;
  v_moovu:=(v_terms->>'moovu_cents')::bigint;
  if t.driver_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||t.driver_id::text,0));end if;
  update public.trips set status='cancelled',cancel_reason=p_reason,cancellation_reason=p_reason,
    cancellation_reason_details=nullif(trim(coalesce(p_reason_details,'')),''),
    cancellation_status_at_request=t.status,cancelled_within_free_window=(v_fee=0),
    cancellation_type=case when v_fee=0 then 'free_cancel' else 'late_cancel' end,
    cancelled_by='customer',cancelled_at=v_now,cancellation_fee_amount=v_fee/100.0,
    cancellation_driver_amount=v_driver/100.0,cancellation_moovu_amount=v_moovu/100.0,
    cancellation_policy_code=p.version,offer_status=null,offer_expires_at=null where id=t.id;
  if v_fee>0 then
    v_assessment:=public.phase4b_record_assessment(t,p,p_actor_id,'LATE_CANCELLATION',v_fee,v_driver,v_moovu,v_now);
  end if;
  select array_agg(distinct driver_id) into v_offered from public.driver_trip_offers
    where trip_id=t.id and status in ('pending','shown');
  update public.driver_trip_offers set status='cancelled',cancelled_at=coalesce(cancelled_at,v_now),
    responded_at=coalesce(responded_at,v_now),updated_at=v_now
    where trip_id=t.id and status in ('pending','shown');
  if t.driver_id is not null then update public.drivers set busy=false where id=t.driver_id;end if;
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
  values(t.id,'trip_cancelled','Phase 4 Customer cancellation, fee cents '||v_fee,t.status,'cancelled',p_actor_id);
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('phase4:customer-cancel:'||t.id,'trip_cancelled','trip',t.id,p_actor_id,
    jsonb_build_object('assessment_id',v_assessment,'fee_cents',v_fee,'driver_cents',v_driver,
      'moovu_cents',v_moovu,'policy_version',p.version,'offered_driver_ids',v_offered)) returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
  values(v_event,'trip_cancelled',jsonb_build_object('trip_id',t.id,'customer_id',t.customer_id,
    'driver_id',t.driver_id,'assessment_id',v_assessment));
  return jsonb_build_object('trip_id',t.id,'replayed',false,'assessment_id',v_assessment,
    'fee_cents',v_fee,'driver_cents',v_driver,'moovu_cents',v_moovu);
end $$;
create or replace function public.phase4b_mark_customer_no_show(p_trip_id uuid,p_driver_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.trips;p public.phase4_policies;v_now timestamptz;v_fee bigint;v_driver bigint;v_moovu bigint;
  v_assessment uuid;v_event uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required';end if;
  select * into t from public.trips where id=p_trip_id for update;
  if not found or t.driver_id is distinct from p_driver_id or not exists
    (select 1 from public.driver_accounts where driver_id=p_driver_id and user_id=p_actor_id) then
    raise exception 'Trip assignment changed or Driver unauthorized';end if;
  if t.status='cancelled' and exists(select 1 from public.moovu_business_events
    where event_key='phase4:no-show:'||t.id) then
    select id into v_assessment from public.phase4_fee_assessments where trip_id=t.id;
    return jsonb_build_object('trip_id',t.id,'replayed',true,'assessment_id',v_assessment);
  end if;
  if t.status<>'arrived' or not coalesce(t.arrival_evidence_qualified,false)
    or t.driver_arrived_at is null or nullif(t.arrival_evidence_version,'') is null then
    raise exception 'No-show requires qualified server-recorded arrival';end if;
  v_now:=clock_timestamp();
  select * into p from public.phase4_policies where effective_from<=v_now order by effective_from desc limit 1;
  if not found or t.created_at<(select min(effective_from) from public.phase4_policies) then raise exception 'Trip predates active Phase 4 policy';end if;
  perform public.phase4b_assert_owner_policy(p);
  if v_now<t.driver_arrived_at+make_interval(secs=>p.no_show_seconds) then
    raise exception 'No-show waiting period has not elapsed';end if;
  if public.phase4b_service(t.ride_option)='GO_XL' then
    v_fee:=p.xl_no_show_cents;v_driver:=p.xl_no_show_driver_cents;v_moovu:=p.xl_no_show_moovu_cents;
  else v_fee:=p.go_no_show_cents;v_driver:=p.go_no_show_driver_cents;v_moovu:=p.go_no_show_moovu_cents;end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||t.driver_id::text,0));
  update public.trips set status='cancelled',cancel_reason='Customer no-show',cancellation_reason='Customer no-show',
    cancellation_status_at_request=t.status,cancellation_type='no_show',cancelled_by='driver',cancelled_at=v_now,
    cancellation_fee_amount=v_fee/100.0,cancellation_driver_amount=v_driver/100.0,
    cancellation_moovu_amount=v_moovu/100.0,cancellation_policy_code=p.version,
    no_show_eligible_at=t.driver_arrived_at+make_interval(secs=>p.no_show_seconds),
    offer_status=null,offer_expires_at=null where id=t.id;
  v_assessment:=public.phase4b_record_assessment(t,p,p_actor_id,'NO_SHOW',v_fee,v_driver,v_moovu,v_now);
  update public.drivers set busy=false where id=t.driver_id;
  update public.driver_trip_offers set status='cancelled',cancelled_at=coalesce(cancelled_at,v_now),
    responded_at=coalesce(responded_at,v_now),updated_at=v_now
    where trip_id=t.id and status in ('pending','shown');
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
  values(t.id,'customer_no_show','Phase 4 no-show, fee cents '||v_fee,t.status,'cancelled',p_actor_id);
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('phase4:no-show:'||t.id,'customer_no_show','trip',t.id,p_actor_id,
    jsonb_build_object('assessment_id',v_assessment,'fee_cents',v_fee,'driver_cents',v_driver,
      'moovu_cents',v_moovu,'policy_version',p.version)) returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
  values(v_event,'customer_no_show',jsonb_build_object('trip_id',t.id,'customer_id',t.customer_id,
    'driver_id',t.driver_id,'assessment_id',v_assessment));
  return jsonb_build_object('trip_id',t.id,'replayed',false,'assessment_id',v_assessment,
    'fee_cents',v_fee,'driver_cents',v_driver,'moovu_cents',v_moovu);
end $$;
commit;
