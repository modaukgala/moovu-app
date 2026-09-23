-- REVIEW ONLY. Production requires separate approval. No policy/ledger/timing changes.
begin;
set local lock_timeout='5s';
do $migration$
declare
  target regprocedure := 'public.reserve_trip_offer(uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric)'::regprocedure;
  definition text;
  old_subscription text := $oldsub$     or v_driver.last_seen < now() - interval '8 hours'
     or v_driver.subscription_status not in ('active','grace')
     or v_driver.subscription_expires_at is null
     or v_driver.subscription_expires_at <= now() then$oldsub$;
  new_subscription text := $newsub$     or v_driver.last_seen is null
     or v_driver.last_seen < now() - interval '8 hours' then$newsub$;
  old_finance text := $oldfinance$  select coalesce(w.balance_due, 0) into v_balance
  from public.driver_wallets w
  where w.driver_id = p_driver_id;
  if coalesce(v_balance, 0) >= 100 then
    raise exception 'Driver commission balance is locked' using errcode = 'P0001';
  end if;$oldfinance$;
  new_finance text := $newfinance$  -- p0-dispatch-authority-v1: one financial authority, including mode/cutoff.
  if not coalesce((public.phase2_finance_eligibility(p_driver_id)->>'authoritative_eligible')::boolean,false) then
    raise exception 'Driver financial eligibility is inactive' using errcode = 'P0001';
  end if;$newfinance$;
  old_class text := '  if coalesce(v_driver.seating_capacity, 0) < v_required_seats then';
  new_class text := $class$  -- Mirror the established XL rule: seven vehicle seats = six passengers + driver.
  if coalesce(v_driver.seating_capacity, 0) < v_required_seats
     or (v_required_seats=6 and v_driver.seating_capacity<>7) then$class$;
  offer_anchor text := '  insert into public.driver_trip_offers(';
  attempt_guard text := $attempt$  -- Canonical attempt history; no legacy array dual write.
  if exists(select 1 from public.driver_trip_offers o where o.trip_id=p_trip_id
      and o.driver_id=p_driver_id and o.dispatch_cycle>=greatest(1,p_dispatch_cycle)) then
    raise exception 'Driver already attempted in this or a newer round' using errcode='P0001';
  end if;

$attempt$;
begin
  select pg_get_functiondef(target) into definition;
  if position('p0-dispatch-authority-v1' in definition)>0 then
    if md5(replace(definition,chr(13),''))<>'ee6b010e2923ba3d39d2c90eb76ab337' then
      raise exception 'P0 dispatch preflight: repaired definition drifted';
    end if;
    raise notice 'P0 dispatch recovery already installed'; return;
  end if;
  if md5(replace(definition,chr(13),''))<>'052109bd24d19fe0bb46aa67c73366a6' then
    raise exception 'P0 dispatch preflight: expected reservation definition changed';
  end if;
  -- SQL clients can normalize newlines. Verify the normalized baseline first, then
  -- normalize only line endings for exact surgical replacement matching.
  definition := replace(definition,chr(13),'');
  old_subscription := replace(old_subscription,chr(13),'');
  new_subscription := replace(new_subscription,chr(13),'');
  old_finance := replace(old_finance,chr(13),'');
  new_finance := replace(new_finance,chr(13),'');
  attempt_guard := replace(attempt_guard,chr(13),'');
  if position(old_subscription in definition)=0 or position(old_finance in definition)=0
    or position(old_class in definition)=0 then
    raise exception 'P0 dispatch preflight: expected eligibility clauses changed';
  end if;
  if not exists(select 1 from public.phase2_finance_policy where policy_key='phase2-driver-finance'
      and mode='AUTHORITATIVE' and authoritative_effective_from<=now()
      and not subscription_required and go_basis_points=1500 and go_xl_basis_points=1500
      and debt_limit_cents=5000) then
    raise exception 'P0 dispatch preflight: expected current AUTHORITATIVE policy required';
  end if;
  new_class := replace(new_class,chr(13),'');
  execute replace(replace(replace(replace(definition,old_subscription,new_subscription),
    old_finance,new_finance),old_class,new_class),offer_anchor,attempt_guard||offer_anchor);
end $migration$;
commit;
