-- Disposable only. Release package includes this compatibility change inline.
begin;
alter table public.trip_cancellation_fees add column phase4_assessment_id uuid unique references public.phase4_fee_assessments(id) on delete restrict;
create or replace function public.phase4b_record_assessment(p_trip public.trips,p_policy public.phase4_policies,
  p_actor_id uuid,p_fee_type text,p_fee bigint,p_driver bigint,p_moovu bigint,p_at timestamptz)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_assessment uuid;v_liability uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required';end if;
  if p_trip.driver_id is null or p_fee<=0 or p_driver<=0 or p_moovu<=0 or p_fee<>p_driver+p_moovu then
    raise exception 'Invalid assessed fee split';end if;
  insert into public.phase4_fee_assessments(trip_id,customer_id,driver_id,fee_type,service_type,
    policy_version,policy_effective_from,assessed_at,clock_basis,locked_trip_state,assigned_driver_id,
    fee_cents,driver_cents,moovu_cents,arrival_evidence_version,source_event_key,idempotency_key)
  values(p_trip.id,p_trip.customer_id,p_trip.driver_id,p_fee_type,public.phase4b_service(p_trip.ride_option),
    p_policy.version,p_policy.effective_from,p_at,
    case when p_fee_type='NO_SHOW' then 'SERVER_ARRIVED_AT' else 'TRIP_CREATED_AT' end,
    p_trip.status,p_trip.driver_id,p_fee,p_driver,p_moovu,
    case when p_fee_type='NO_SHOW' then p_trip.arrival_evidence_version else null end,
    'phase4:'||lower(p_fee_type)||':'||p_trip.id,'phase4:assessment:'||p_trip.id)
  returning id into v_assessment;
  insert into public.trip_cancellation_fees(trip_id,customer_id,driver_id,fee_type,
    fee_amount,driver_amount,moovu_amount,reason,created_by,phase4_assessment_id)
  values(p_trip.id,p_trip.customer_id,p_trip.driver_id,
    case when p_fee_type='NO_SHOW' then 'no_show' else 'late_cancel' end,
    p_fee/100.0,p_driver/100.0,p_moovu/100.0,'Phase 4 assessment projection',p_actor_id,v_assessment);
  insert into public.phase4_customer_liabilities(assessment_id,customer_id,original_cents,open_cents,
    status,finalized_at,source_key)
  values(v_assessment,p_trip.customer_id,p_fee,p_fee,'OPEN',p_at,'phase4:liability:'||v_assessment)
  returning id into v_liability;
  insert into public.phase4_driver_compensations(assessment_id,driver_id,earned_cents,status,earned_at,source_key)
  values(v_assessment,p_trip.driver_id,p_driver,'EARNED',p_at,'phase4:compensation:'||v_assessment);
  insert into public.phase4_customer_grace_cycles(customer_id,started_at,source_liability_id)
  values(p_trip.customer_id,p_at,v_liability)
  on conflict(customer_id) where resolved_at is null do nothing;
  perform public.phase4b_post_assessment(v_assessment,p_actor_id);
  return v_assessment;
end $$;
commit;
