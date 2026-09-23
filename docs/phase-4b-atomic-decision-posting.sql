-- Phase 4B disposable-only package. Do not install in production or insert an active policy.
-- Existing application routes continue to call Phase 05B until a separately reviewed cutover.
begin;

alter table public.financial_transactions drop constraint financial_transactions_source_type_check;
alter table public.financial_transactions add constraint financial_transactions_source_type_check
  check (source_type in ('TRIP','DRIVER_SETTLEMENT','DRIVER_PAYMENT_REQUEST',
    'DRIVER_SUBSCRIPTION_PAYMENT','TRIP_CANCELLATION_FEE','PHASE4_ASSESSMENT',
    'FINANCIAL_TRANSACTION','ADJUSTMENT'));

-- Read-only compatibility for existing Driver earnings/Admin reports. The Phase 4
-- assessment is canonical; this row is not an independent posting source.
alter table public.trip_cancellation_fees add column phase4_assessment_id uuid
  unique references public.phase4_fee_assessments(id) on delete restrict;

-- Quotes are server-issued records, not client assertions about a fee or clock.
create table public.phase4b_cancellation_quotes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  policy_version text not null references public.phase4_policies(version) on delete restrict,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  terms jsonb not null,
  check (expires_at>issued_at and expires_at<=issued_at+interval '30 seconds')
);
create index phase4b_quotes_trip_idx on public.phase4b_cancellation_quotes(trip_id,issued_at desc);
alter table public.phase4b_cancellation_quotes enable row level security;
revoke all on public.phase4b_cancellation_quotes from public,anon,authenticated,service_role;
grant select on public.phase4b_cancellation_quotes to service_role;

create function public.phase4b_service(p_option text) returns text
language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if lower(coalesce(p_option,'')) in ('group','xl','moovu_go_xl') then return 'GO_XL'; end if;
  if lower(coalesce(p_option,'')) in ('go','standard','moovu_go') then return 'GO'; end if;
  raise exception 'Unknown ride option requires manual review';
end $$;

create function public.phase4b_assert_owner_policy(p public.phase4_policies) returns void
language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if p.version is null or p.currency<>'ZAR' or p.free_seconds<>180 or p.no_show_seconds<>300
    or (p.go_late_cents,p.go_late_driver_cents,p.go_late_moovu_cents) is distinct from (2000::bigint,1300::bigint,700::bigint)
    or (p.xl_late_cents,p.xl_late_driver_cents,p.xl_late_moovu_cents) is distinct from (3000::bigint,2000::bigint,1000::bigint)
    or (p.go_no_show_cents,p.go_no_show_driver_cents,p.go_no_show_moovu_cents) is distinct from (3000::bigint,2200::bigint,800::bigint)
    or (p.xl_no_show_cents,p.xl_no_show_driver_cents,p.xl_no_show_moovu_cents) is distinct from (4000::bigint,3000::bigint,1000::bigint)
  then raise exception 'Unapproved Phase 4 financial policy';end if;
end $$;

-- All terms are recomputed under the trip lock; absence of policy fails closed.
create function public.phase4b_cancellation_terms(p_trip public.trips,p_policy public.phase4_policies,p_at timestamptz)
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

create function public.phase4b_quote_customer_cancellation(p_trip_id uuid,p_customer_id uuid,p_actor_id uuid)
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

-- Narrow posting writer: one immutable assessment, terminal state, three balanced entries,
-- and the existing Phase 1 terminal unique index. No cash or recognized revenue.
-- It requires the separately approved Phase 1 cutover file before invocation.

create function public.phase4b_post_assessment(p_assessment_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.phase4_fee_assessments;t public.trips;v_tx uuid;v_receivable public.financial_accounts;
  v_payable public.financial_accounts;v_clearing public.financial_accounts;v_key text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required';end if;
  select * into a from public.phase4_fee_assessments where id=p_assessment_id;
  if not found then raise exception 'Assessment missing';end if;
  select * into t from public.trips where id=a.trip_id for update;
  if t.status<>'cancelled' or t.customer_id is distinct from a.customer_id or t.driver_id is distinct from a.driver_id
    or (a.fee_type='NO_SHOW' and t.cancellation_type<>'no_show')
    or (a.fee_type='LATE_CANCELLATION' and t.cancellation_type<>'late_cancel') then
    raise exception 'Terminal trip state does not match Phase 4 assessment';end if;
  v_key:='phase4:assessment:'||a.id;
  select id into v_tx from public.financial_transactions where idempotency_key=v_key;
  if found then
    if not exists(select 1 from public.financial_transactions where id=v_tx and source_type='PHASE4_ASSESSMENT'
      and source_id=a.id and transaction_state='POSTED') then raise exception 'Conflicting posting replay';end if;
    return v_tx;
  end if;
  v_receivable:=public.phase1_ensure_financial_account('PHASE4:RECEIVABLE:'||a.customer_id,
    'CANCELLATION_NO_SHOW_RECEIVABLE','CUSTOMER',a.customer_id,'DEBIT','ZAR');
  v_payable:=public.phase1_ensure_financial_account('PHASE4:PAYABLE:'||a.driver_id,
    'DRIVER_COMPENSATION_PAYABLE','DRIVER',a.driver_id,'CREDIT','ZAR');
  select * into v_clearing from public.financial_accounts
    where account_category='ADJUSTMENT_CLEARING' and owner_type='PLATFORM' and owner_id is null
      and currency='ZAR' and normal_balance_side='CREDIT' and account_status='ACTIVE' for update;
  if not found then
    v_clearing:=public.phase1_ensure_financial_account('PHASE4:ASSESSMENT:CLEARING',
      'ADJUSTMENT_CLEARING','PLATFORM',null,'CREDIT','ZAR');
  end if;
  -- Phase 1 itself owns the posting state and deferred balance check.
  -- Its source and terminal guards are extended in this migration below.
  select (public.phase1_post_financial_transaction(v_key,
    encode(sha256(convert_to(a.id::text||':'||a.fee_cents||':'||a.driver_cents||':'||a.moovu_cents,'UTF8')),'hex'),
    case when a.fee_type='NO_SHOW' then 'NO_SHOW_FEE' else 'CANCELLATION_FEE' end,
    'PHASE4_ASSESSMENT',a.id,'ZAR','SYSTEM',p_actor_id,a.assessed_at,
    jsonb_build_array(jsonb_build_object('account_id',v_receivable.id,'entry_side','DEBIT','amount_cents',a.fee_cents),
      jsonb_build_object('account_id',v_payable.id,'entry_side','CREDIT','amount_cents',a.driver_cents),
      jsonb_build_object('account_id',v_clearing.id,'entry_side','CREDIT','amount_cents',a.moovu_cents)),
    jsonb_build_object('phase4_assessment_id',a.id,'recognition','ASSESSMENT_CLEARING')) ->> 'transaction_id')::uuid into v_tx;
  return v_tx;
end $$;

-- Called only from a locked, terminal writer in the same transaction. No legacy
-- cancellation-credit is created: Phase 1 payable is the sole earned obligation.
create function public.phase4b_record_assessment(p_trip public.trips,p_policy public.phase4_policies,
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

create function public.phase4b_cancel_customer_trip(p_trip_id uuid,p_customer_id uuid,p_actor_id uuid,
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
  if not found or t.created_at<p.effective_from then raise exception 'Trip predates active Phase 4 policy';end if;
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

create function public.phase4b_mark_customer_no_show(p_trip_id uuid,p_driver_id uuid,p_actor_id uuid)
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

-- Future dispatch cutover replaces the current multi-request expiry with one
-- guarded transaction; it is deliberately not wired into the current app.
create function public.phase4b_expire_dispatch_trip(p_trip_id uuid)
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

-- A separate replacement for safe pre-start operational cancellation. The
-- existing admin/driver RPC remains unchanged until the coordinated cutover.
create function public.phase4b_cancel_trip_operational(p_trip_id uuid,p_actor_id uuid,p_actor_kind text,p_reason text)
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

-- Narrow unpaid-assessment reversal contract; full dispute/refund/settlement UI
-- remains a later gate. Posted history is compensated, never deleted.
create function public.phase4b_reverse_unpaid_assessment(p_assessment_id uuid,p_actor_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.phase4_fee_assessments;l public.phase4_customer_liabilities;
  c public.phase4_driver_compensations;v_original uuid;v_reversal uuid;v_result jsonb;v_now timestamptz;v_prior_reason text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required';end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin'))
    then raise exception 'Owner/Admin required';end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Reversal reason required';end if;
  select * into a from public.phase4_fee_assessments where id=p_assessment_id;
  if not found then raise exception 'Assessment not found';end if;
  perform 1 from public.trips where id=a.trip_id for update;
  select * into l from public.phase4_customer_liabilities where assessment_id=a.id for update;
  select * into c from public.phase4_driver_compensations where assessment_id=a.id for update;
  if not found or l.id is null or c.id is null then raise exception 'Assessment projections incomplete';end if;
  select financial_transaction_id,reason into v_reversal,v_prior_reason from public.phase4_financial_actions
    where source_key='phase4:reversal:'||a.id;
  if found then
    if v_prior_reason<>trim(p_reason) then raise exception 'Conflicting reversal replay';end if;
    return jsonb_build_object('assessment_id',a.id,'reversal_transaction_id',v_reversal,'replayed',true);end if;
  if l.collected_cents<>0 or l.waived_cents<>0 or l.written_off_cents<>0
    or l.reversed_cents<>0 or c.settled_cents<>0 or c.status in ('SETTLED','CREDITED','REVERSED') then
    raise exception 'Unpaid, unsettled assessment required for this reversal';end if;
  select id into v_original from public.financial_transactions where source_type='PHASE4_ASSESSMENT'
    and source_id=a.id and transaction_state='POSTED' for update;
  if not found then raise exception 'Posted assessment transaction required';end if;
  v_now:=clock_timestamp();
  v_result:=public.phase1_reverse_financial_transaction(v_original,'phase4:reversal:'||a.id,
    encode(sha256(convert_to(a.id::text||':'||v_original::text||':'||trim(p_reason),'UTF8')),'hex'),
    p_actor_id,p_reason);
  v_reversal:=(v_result->>'transaction_id')::uuid;
  update public.phase4_customer_liabilities set open_cents=0,reversed_cents=original_cents,
    status='REVERSED',resolution_at=v_now,resolution_actor_id=p_actor_id,
    resolution_reason=trim(p_reason),updated_at=v_now where id=l.id;
  update public.phase4_driver_compensations set status='REVERSED',updated_at=v_now where id=c.id;
  insert into public.phase4_financial_actions(assessment_id,action_type,amount_cents,source_key,
    actor_id,reason,financial_transaction_id)
  values(a.id,'REVERSAL',a.fee_cents,'phase4:reversal:'||a.id,p_actor_id,trim(p_reason),v_reversal);
  if not exists(select 1 from public.phase4_customer_liabilities where customer_id=a.customer_id
    and status='OPEN' and open_cents>0) then
    update public.phase4_customer_grace_cycles set resolved_at=v_now
      where customer_id=a.customer_id and resolved_at is null;
  end if;
  return jsonb_build_object('assessment_id',a.id,'reversal_transaction_id',v_reversal,'replayed',false);
end $$;

revoke all on function public.phase4b_service(text),public.phase4b_assert_owner_policy(public.phase4_policies),
  public.phase4b_cancellation_terms(public.trips,public.phase4_policies,timestamptz),
  public.phase4b_quote_customer_cancellation(uuid,uuid,uuid),public.phase4b_post_assessment(uuid,uuid),
  public.phase4b_record_assessment(public.trips,public.phase4_policies,uuid,text,bigint,bigint,bigint,timestamptz),
  public.phase4b_cancel_customer_trip(uuid,uuid,uuid,uuid,text,text),public.phase4b_mark_customer_no_show(uuid,uuid,uuid),
  public.phase4b_expire_dispatch_trip(uuid),public.phase4b_cancel_trip_operational(uuid,uuid,text,text),
  public.phase4b_reverse_unpaid_assessment(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.phase4b_quote_customer_cancellation(uuid,uuid,uuid),
  public.phase4b_cancel_customer_trip(uuid,uuid,uuid,uuid,text,text),public.phase4b_mark_customer_no_show(uuid,uuid,uuid),
  public.phase4b_expire_dispatch_trip(uuid),public.phase4b_cancel_trip_operational(uuid,uuid,text,text),
  public.phase4b_reverse_unpaid_assessment(uuid,uuid,text)
  to service_role;
commit;
