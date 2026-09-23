-- Phase 4 booking authority, completion consumption, and bounded Admin actions.
-- Validate on disposable before production installation. No historical backfill.
begin;

create function public.phase4_customer_debt_state(p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_cycle public.phase4_customer_grace_cycles; v_open bigint; v_disputed boolean; v_used integer;
begin
  select * into v_cycle from public.phase4_customer_grace_cycles
    where customer_id=p_customer_id and resolved_at is null;
  select coalesce(sum(open_cents) filter(where status='OPEN'),0),
    coalesce(bool_or(status='DISPUTED' and open_cents>0),false)
    into v_open,v_disputed from public.phase4_customer_liabilities
    where customer_id=p_customer_id and open_cents>0;
  if v_cycle.id is not null then
    select count(*) into v_used from public.phase4_grace_ride_consumptions where cycle_id=v_cycle.id;
  else v_used:=0; end if;
  return jsonb_build_object('cycle_id',v_cycle.id,'open_cents',v_open,'disputed',v_disputed,
    'completed_rides',v_used,'remaining_rides',greatest(0,2-v_used),
    'booking_blocked',v_cycle.id is not null and v_open>0 and not v_disputed and v_used>=2);
end $$;

create function public.phase4_customer_booking_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_state jsonb;
begin
  -- created_by is present for privileged operational bookings; Customer bookings leave it null.
  if new.customer_id is null or new.created_by is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('phase4-grace:'||new.customer_id::text,0));
  v_state:=public.phase4_customer_debt_state(new.customer_id);
  if (v_state->>'booking_blocked')::boolean then
    raise exception 'PHASE4_BOOKING_BLOCKED: unresolved cancellation or no-show debt after two completed rides'
      using errcode='P0001';
  end if;
  return new;
end $$;

create trigger phase4_customer_booking_guard_trigger before insert on public.trips
for each row execute function public.phase4_customer_booking_guard();

create function public.phase4_consume_completed_ride()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cycle public.phase4_customer_grace_cycles; v_state jsonb;
begin
  if new.status<>'completed' or old.status='completed' or new.customer_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('phase4-grace:'||new.customer_id::text,0));
  select * into v_cycle from public.phase4_customer_grace_cycles
    where customer_id=new.customer_id and resolved_at is null for update;
  if v_cycle.id is null or new.created_at<v_cycle.started_at
    or coalesce(new.completed_at,clock_timestamp())<v_cycle.started_at then return new; end if;
  v_state:=public.phase4_customer_debt_state(new.customer_id);
  if (v_state->>'disputed')::boolean or (v_state->>'open_cents')::bigint<=0 then return new; end if;
  insert into public.phase4_grace_ride_consumptions(cycle_id,completed_trip_id,completed_at,
    trip_status_at_consumption,source_key)
  values(v_cycle.id,new.id,coalesce(new.completed_at,clock_timestamp()),'completed',
    'phase4:grace-completion:'||new.id)
  on conflict(completed_trip_id) do nothing;
  return new;
end $$;

create trigger phase4_consume_completed_ride_trigger after update of status on public.trips
for each row execute function public.phase4_consume_completed_ride();

create function public.phase4_admin_liability_action(p_assessment_id uuid,p_actor_id uuid,
  p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.phase4_fee_assessments; l public.phase4_customer_liabilities;
  c public.phase4_driver_compensations; v_now timestamptz; v_key text;
  v_existing public.phase4_financial_actions; v_receivable public.financial_accounts;
  v_clearing public.financial_accounts; v_post jsonb; v_tx uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin'))
    then raise exception 'Owner/Admin required'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Action reason required'; end if;
  if p_action not in ('DISPUTE_OPENED','DISPUTE_RESOLVED','WAIVER') then
    raise exception 'Unsupported liability action'; end if;
  select * into a from public.phase4_fee_assessments where id=p_assessment_id;
  if not found then raise exception 'Assessment not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('phase4-grace:'||a.customer_id::text,0));
  perform 1 from public.trips where id=a.trip_id for update;
  select * into l from public.phase4_customer_liabilities where assessment_id=a.id for update;
  select * into c from public.phase4_driver_compensations where assessment_id=a.id for update;
  if l.id is null or c.id is null then raise exception 'Assessment projections incomplete'; end if;
  v_key:='phase4:admin:'||p_action||':'||a.id;
  select * into v_existing from public.phase4_financial_actions where source_key=v_key;
  if found then
    if v_existing.reason<>trim(p_reason) or v_existing.actor_id<>p_actor_id then
      raise exception 'Conflicting action replay'; end if;
    return jsonb_build_object('assessment_id',a.id,'action_id',v_existing.id,'replayed',true);
  end if;
  v_now:=clock_timestamp();
  if p_action='DISPUTE_OPENED' then
    if l.status<>'OPEN' or l.open_cents<=0 then raise exception 'Open liability required for dispute'; end if;
    update public.phase4_customer_liabilities set status='DISPUTED',disputed_at=v_now,updated_at=v_now
      where id=l.id;
  elsif p_action='DISPUTE_RESOLVED' then
    if l.status<>'DISPUTED' or l.open_cents<=0 then raise exception 'Active dispute required'; end if;
    update public.phase4_customer_liabilities set status='OPEN',updated_at=v_now where id=l.id;
  else
    if l.status not in ('OPEN','DISPUTED') or l.open_cents<>l.original_cents
      or l.collected_cents<>0 or l.waived_cents<>0 or l.written_off_cents<>0
      or l.reversed_cents<>0 or c.status in ('CREDITED','SETTLED','REVERSED')
      or c.settled_cents<>0 then
      raise exception 'Wholly unpaid, unsettled liability required for waiver'; end if;
    select * into v_receivable from public.financial_accounts
      where account_code=upper('PHASE4:RECEIVABLE:'||a.customer_id) and account_status='ACTIVE' for update;
    select * into v_clearing from public.financial_accounts
      where account_category='ADJUSTMENT_CLEARING' and owner_type='PLATFORM' and owner_id is null
        and currency='ZAR' and normal_balance_side='CREDIT' and account_status='ACTIVE'
      order by id limit 1 for update;
    if v_receivable.id is null or v_clearing.id is null then
      raise exception 'Phase 4 waiver financial accounts missing'; end if;
    v_post:=public.phase1_post_financial_transaction(
      'phase4:waiver:'||a.id,
      encode(sha256(convert_to(a.id::text||':'||l.original_cents||':'||trim(p_reason),'UTF8')),'hex'),
      'ADJUSTMENT','PHASE4_ASSESSMENT',a.id,'ZAR','ADMIN',p_actor_id,v_now,
      jsonb_build_array(
        jsonb_build_object('account_id',v_clearing.id,'entry_side','DEBIT','amount_cents',l.original_cents),
        jsonb_build_object('account_id',v_receivable.id,'entry_side','CREDIT','amount_cents',l.original_cents)),
      jsonb_build_object('phase4_assessment_id',a.id,'recognition','CUSTOMER_WAIVER_CLEARING'));
    v_tx:=(v_post->>'transaction_id')::uuid;
    update public.phase4_customer_liabilities set open_cents=0,waived_cents=original_cents,
      status='WAIVED',resolution_at=v_now,resolution_actor_id=p_actor_id,
      resolution_reason=trim(p_reason),updated_at=v_now where id=l.id;
    if not exists(select 1 from public.phase4_customer_liabilities
      where customer_id=a.customer_id and status in ('OPEN','DISPUTED') and open_cents>0) then
      update public.phase4_customer_grace_cycles set resolved_at=v_now
        where customer_id=a.customer_id and resolved_at is null;
    end if;
  end if;
  insert into public.phase4_financial_actions(assessment_id,action_type,amount_cents,
    source_key,actor_id,reason,financial_transaction_id)
  values(a.id,p_action,case when p_action='WAIVER' then l.original_cents else 0 end,
    v_key,p_actor_id,trim(p_reason),v_tx) returning * into v_existing;
  return jsonb_build_object('assessment_id',a.id,'action_id',v_existing.id,'replayed',false);
end $$;

revoke all on function public.phase4_customer_debt_state(uuid),
  public.phase4_customer_booking_guard(),public.phase4_consume_completed_ride(),
  public.phase4_admin_liability_action(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.phase4_customer_debt_state(uuid),
  public.phase4_admin_liability_action(uuid,uuid,text,text) to service_role;
commit;
