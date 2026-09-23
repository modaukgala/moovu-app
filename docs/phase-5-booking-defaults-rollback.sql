-- REVIEW ONLY: rollback restores the pre-repair INSERT and REINTRODUCES the booking outage.
-- Emergency use only after approval; prefer a forward repair. No FK or data change.
begin;
do $rollback$
begin
 if md5(pg_get_functiondef('public.phase5_create_trip(uuid,uuid,text,jsonb,bigint,text,bigint)'::regprocedure)) <> '2995edfe238920f45c67ffe730f76005' then
  raise exception 'Rollback preflight failed: function changed; review manually';
 end if;
 execute $restore$
CREATE OR REPLACE FUNCTION public.phase5_create_trip(p_customer_id uuid, p_actor_id uuid, p_booking_key text, p_trip_payload jsonb, p_ride_fare_cents bigint, p_ride_option text, p_expected_customer_total_cents bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$
;
$restore$;
end $rollback$;
commit;

