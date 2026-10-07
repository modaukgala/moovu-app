-- Retire subscription eligibility only; retain approval, operational checks, ledger authority, and historical records.
CREATE OR REPLACE FUNCTION public.phase05b_assign_driver(p_trip_id uuid, p_driver_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.trips%rowtype;d public.drivers%rowtype;v_role text;v_event uuid;
begin
  select role into v_role from public.profiles where id=p_actor_id;
  if v_role not in ('owner','admin','dispatcher','support') then raise exception 'Manual assignment not authorized' using errcode='P0001';end if;
  -- Consistent order: trip, then driver. Existing dispatch functions must be reviewed to match before activation.
  select * into t from public.trips where id=p_trip_id for update;
  if not found or t.status not in ('requested','offered') or t.driver_id is not null then raise exception 'Trip is not assignable' using errcode='P0001';end if;
  select * into d from public.drivers where id=p_driver_id for update;
  if not found or coalesce(d.is_deleted,false) or coalesce(d.busy,false) or not coalesce(d.online,false)
     or d.status not in ('approved','active') or coalesce(d.verification_status,'')<>'approved'
     or not coalesce(d.profile_completed,false) then raise exception 'Driver is not hard-eligible' using errcode='P0001';end if;
  if exists(select 1 from public.trips where driver_id=d.id and status in ('assigned','arrived','ongoing') and id<>t.id) then
    raise exception 'Driver already has an active trip' using errcode='P0001';end if;
  -- Production records assignment/acceptance through status plus trip_events;
  -- accepted_at/assigned_at columns do not exist and are intentionally not added.
  update public.trips set driver_id=d.id,status='assigned',offer_status='accepted' where id=t.id;
  update public.drivers set busy=true where id=d.id;
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
    values(t.id,'assignment','Manually assigned eligible driver '||d.id,t.status,'assigned',p_actor_id);
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
    values('trip-assigned:'||t.id::text,'trip_assigned','trip',t.id,p_actor_id,jsonb_build_object('driver_id',d.id,'source','admin_manual'))
    returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'trip_assigned',jsonb_build_object('trip_id',t.id,'driver_id',d.id));
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'driver_id',d.id,'replayed',false);
end $function$
;

CREATE OR REPLACE FUNCTION public.phase2_finance_eligibility(p_driver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_policy public.phase2_finance_policy; v_position jsonb; v_driver public.drivers;
        v_legacy_cents bigint:=0; v_effective_mode text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into strict v_policy from public.phase2_finance_policy where policy_key='phase2-driver-finance';
  select * into strict v_driver from public.drivers where id=p_driver_id;
  v_position:=public.phase2_driver_finance_position(p_driver_id);
  select greatest(round(coalesce(balance_due,0)*100),0)::bigint into v_legacy_cents
    from public.driver_wallets where driver_id=p_driver_id;
  v_legacy_cents:=coalesce(v_legacy_cents,0);
  v_effective_mode:=case when v_policy.mode='AUTHORITATIVE'
      and v_policy.authoritative_effective_from is not null
      and now()>=v_policy.authoritative_effective_from then 'AUTHORITATIVE'
    when v_policy.mode='OFF' then 'OFF' else 'SHADOW' end;
  return v_position||jsonb_build_object(
    'mode',v_effective_mode,'configured_mode',v_policy.mode,
    'authoritative_effective_from',v_policy.authoritative_effective_from,
    'legacy_debt_cents',v_legacy_cents,
    'phase2_eligible',(v_position->>'financially_eligible')::boolean,
    'authoritative_eligible',case when v_effective_mode='AUTHORITATIVE'
      then (v_position->>'financially_eligible')::boolean else true end,
    'subscription_required',false);
end $function$;
