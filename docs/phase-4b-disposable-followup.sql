-- Disposable follow-up for final source package; no production execution.
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
  if t.created_at<p.effective_from then raise exception 'Trip predates active Phase 4 policy';end if;
  v_terms:=public.phase4b_cancellation_terms(t,p,v_now);
  insert into public.phase4b_cancellation_quotes(trip_id,customer_id,policy_version,issued_at,expires_at,terms)
    values(t.id,p_customer_id,p.version,v_now,v_now+interval '30 seconds',v_terms) returning * into v_quote;
  return jsonb_build_object('quote_id',v_quote.id,'issued_at',v_quote.issued_at,
    'expires_at',v_quote.expires_at,'authoritative_at',v_now,'terms',v_terms);
end $$;
create or replace function public.phase4b_expire_dispatch_trip(p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.trips;v_at timestamptz;v_event uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required';end if;
  select * into t from public.trips where id=p_trip_id for update;
  if not found then raise exception 'Trip not found';end if;
  if t.status='cancelled' and t.cancelled_by='system' then
    return jsonb_build_object('trip_id',t.id,'replayed',true);end if;
  if t.status not in ('requested','offered') or t.driver_id is not null then
    return jsonb_build_object('trip_id',t.id,'changed',false);end if;
  v_at:=clock_timestamp();
  if v_at<t.created_at+interval '30 minutes' then raise exception 'Dispatch expiry not yet due';end if;
  update public.trips set status='cancelled',cancel_reason='No eligible driver accepted within 30 minutes.',
    cancellation_reason='No eligible driver accepted within 30 minutes.',
    cancellation_reason_details='Automatic dispatch timeout',cancelled_by='system',cancelled_at=v_at,
    cancellation_type='dispatch_expiry',cancellation_fee_amount=0,cancellation_driver_amount=0,
    cancellation_moovu_amount=0,offer_status='cancelled',offer_expires_at=null where id=t.id;
  update public.driver_trip_offers set status='cancelled',cancelled_at=coalesce(cancelled_at,v_at),
    responded_at=coalesce(responded_at,v_at),updated_at=v_at
    where trip_id=t.id and status in ('pending','shown');
  update public.dispatch_jobs set status='cancelled',completed_at=coalesce(completed_at,v_at),updated_at=v_at
    where trip_id=t.id and status in ('pending','processing');
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status)
    values(t.id,'dispatch_auto_cancelled','No eligible driver accepted within 30 minutes.',t.status,'cancelled');
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,payload)
    values('phase4:dispatch-expiry:'||t.id,'dispatch_auto_cancelled','trip',t.id,
      jsonb_build_object('trip_id',t.id,'customer_id',t.customer_id)) returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'dispatch_auto_cancelled',jsonb_build_object('trip_id',t.id,'customer_id',t.customer_id));
  return jsonb_build_object('trip_id',t.id,'changed',true,'replayed',false);
end $$;
create or replace function public.phase4b_cancel_trip_operational(p_trip_id uuid,p_actor_id uuid,p_actor_kind text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.trips;v_role text;v_event uuid;v_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required';end if;
  select * into t from public.trips where id=p_trip_id for update;
  if not found then raise exception 'Trip not found';end if;
  if p_actor_kind='admin' then
    select role into v_role from public.profiles where id=p_actor_id;
    if v_role not in ('owner','admin','dispatcher','support') then raise exception 'Admin unauthorized';end if;
  elsif p_actor_kind='driver' then
    if not exists(select 1 from public.driver_accounts where user_id=p_actor_id and driver_id=t.driver_id) then
      raise exception 'Driver unauthorized';end if;
  else raise exception 'Invalid operational actor';end if;
  if t.status='cancelled' then
    if exists(select 1 from public.moovu_business_events where event_key='phase4:operational-cancel:'||t.id)
      then return jsonb_build_object('trip_id',t.id,'replayed',true);end if;
    raise exception 'Trip already has a different terminal outcome';
  end if;
  if t.status not in ('requested','offered','assigned','arrived') or
    (p_actor_kind='driver' and t.status not in ('assigned','arrived')) then
    raise exception 'Started or terminal trip requires separate financial resolution';end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Operational reason required';end if;
  v_at:=clock_timestamp();
  update public.trips set status='cancelled',cancel_reason=p_reason,cancellation_reason=p_reason,
    cancellation_type=p_actor_kind||'_cancelled',cancelled_by=p_actor_kind,cancelled_at=v_at,
    cancellation_fee_amount=0,cancellation_driver_amount=0,cancellation_moovu_amount=0,
    cancellation_policy_code=p_actor_kind||'_cancelled',offer_status=null,offer_expires_at=null where id=t.id;
  update public.driver_trip_offers set status='cancelled',cancelled_at=coalesce(cancelled_at,v_at),
    responded_at=coalesce(responded_at,v_at),updated_at=v_at where trip_id=t.id and status in ('pending','shown');
  update public.dispatch_jobs set status='cancelled',completed_at=coalesce(completed_at,v_at),updated_at=v_at
    where trip_id=t.id and status in ('pending','processing');
  if t.driver_id is not null then update public.drivers set busy=false where id=t.driver_id;end if;
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
    values(t.id,'trip_cancelled_'||p_actor_kind,'Operational cancellation: '||p_reason,t.status,'cancelled',p_actor_id);
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
    values('phase4:operational-cancel:'||t.id,'trip_cancelled_'||p_actor_kind,'trip',t.id,p_actor_id,
      jsonb_build_object('trip_id',t.id,'driver_id',t.driver_id,'reason',p_reason)) returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'trip_cancelled_'||p_actor_kind,
      jsonb_build_object('trip_id',t.id,'customer_id',t.customer_id,'driver_id',t.driver_id));
  return jsonb_build_object('trip_id',t.id,'replayed',false);
end $$;
revoke all on function public.phase4b_expire_dispatch_trip(uuid),public.phase4b_cancel_trip_operational(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.phase4b_expire_dispatch_trip(uuid),public.phase4b_cancel_trip_operational(uuid,uuid,text,text) to service_role;
commit;
