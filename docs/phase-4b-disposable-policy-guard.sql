-- Disposable policy guard follow-up. Release package includes this inline.
begin;
create or replace function public.phase4b_assert_owner_policy(p public.phase4_policies) returns void
language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if p.version is null or p.currency<>'ZAR' or p.free_seconds<>180 or p.no_show_seconds<>300
    or (p.go_late_cents,p.go_late_driver_cents,p.go_late_moovu_cents) is distinct from (2000::bigint,1300::bigint,700::bigint)
    or (p.xl_late_cents,p.xl_late_driver_cents,p.xl_late_moovu_cents) is distinct from (3000::bigint,2000::bigint,1000::bigint)
    or (p.go_no_show_cents,p.go_no_show_driver_cents,p.go_no_show_moovu_cents) is distinct from (3000::bigint,2200::bigint,800::bigint)
    or (p.xl_no_show_cents,p.xl_no_show_driver_cents,p.xl_no_show_moovu_cents) is distinct from (4000::bigint,3000::bigint,1000::bigint)
  then raise exception 'Unapproved Phase 4 financial policy';end if;
end $$;
create or replace function public.phase4b_cancellation_terms(p_trip public.trips,p_policy public.phase4_policies,p_at timestamptz)
returns jsonb language plpgsql stable set search_path=public,pg_temp as $$
declare v_service text; v_free boolean; v_fee bigint;v_driver bigint;v_moovu bigint;
begin
  v_service:=public.phase4b_service(p_trip.ride_option);
  perform public.phase4b_assert_owner_policy(p_policy);
  v_free:=p_trip.driver_id is null or p_trip.status not in ('assigned','arrived')
    or p_at<p_trip.created_at+make_interval(secs=>p_policy.free_seconds);
  if v_free then v_fee:=0;v_driver:=0;v_moovu:=0;
  elsif v_service='GO_XL' then
    v_fee:=p_policy.xl_late_cents;v_driver:=p_policy.xl_late_driver_cents;v_moovu:=p_policy.xl_late_moovu_cents;
  else v_fee:=p_policy.go_late_cents;v_driver:=p_policy.go_late_driver_cents;v_moovu:=p_policy.go_late_moovu_cents;end if;
  return jsonb_build_object('kind',case when v_free then 'FREE' else 'LATE_CANCELLATION' end,
    'fee_cents',v_fee,'driver_cents',v_driver,'moovu_cents',v_moovu,
    'driver_id',p_trip.driver_id,'trip_status',p_trip.status,'service_type',v_service,
    'policy_version',p_policy.version,'policy_effective_from',p_policy.effective_from,
    'free_boundary_at',p_trip.created_at+make_interval(secs=>p_policy.free_seconds));
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
  if not found or t.created_at<p.effective_from then raise exception 'Trip predates active Phase 4 policy';end if;
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
revoke all on function public.phase4b_assert_owner_policy(public.phase4_policies) from public,anon,authenticated,service_role;
commit;
