-- REVIEW ONLY. Requires explicit production approval. No deployment is authorized.
-- Atomic forward recovery: identity -> booking defaults -> dispatch reservation.
-- Do NOT include the disposable parity or validation scripts in production.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
-- REVIEW ONLY: production requires separate approval. No Auth/FK/deletion changes.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $guard$
declare definition text;
begin
  if not exists(select 1 from pg_attribute where attrelid='public.profiles'::regclass
      and attname='id' and atttypid='uuid'::regtype and attnotnull)
    or not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass
      and contype='f' and confrelid='auth.users'::regclass
      and pg_get_constraintdef(oid)='FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE')
    or not exists(select 1 from pg_class where oid='public.profiles'::regclass and relrowsecurity) then
    raise exception 'P0 identity preflight: canonical Auth/profile schema changed';
  end if;
  if exists(select auth_user_id from public.customers group by auth_user_id having count(*)>1)
    or exists(select 1 from public.customers c left join auth.users u on u.id=c.auth_user_id where u.id is null) then
    raise exception 'P0 identity preflight: ambiguous or orphan Customer identity';
  end if;
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.profiles'::regclass and conname='profiles_role_check';
  if definition = 'CHECK ((role = ANY (ARRAY[''owner''::text, ''admin''::text, ''dispatcher''::text, ''support''::text, ''driver''::text])))'
    or definition = 'CHECK ((role = ANY (ARRAY[''owner''::text, ''admin''::text, ''dispatcher''::text, ''support''::text, ''driver''::text]))) NOT VALID' then
    alter table public.profiles drop constraint profiles_role_check;
    alter table public.profiles add constraint profiles_role_check
      check(role in ('owner','admin','dispatcher','support','driver','customer'));
  elsif definition is distinct from 'CHECK ((role = ANY (ARRAY[''owner''::text, ''admin''::text, ''dispatcher''::text, ''support''::text, ''driver''::text, ''customer''::text])))' then
    raise exception 'P0 identity preflight: unexpected role allowlist';
  end if;
  if exists(select 1 from pg_trigger where tgrelid='public.customers'::regclass
      and tgname='p0_customer_actor_profile' and tgfoid is distinct from
      to_regprocedure('public.p0_customer_actor_profile()')) then
    raise exception 'P0 identity preflight: trigger name collision';
  end if;
  if to_regprocedure('public.p0_customer_actor_profile()') is not null
    and md5(replace(pg_get_functiondef(to_regprocedure('public.p0_customer_actor_profile()')),chr(13),''))<>'2388d4d24fa0a304cedc66d3c66913ad' then
    raise exception 'P0 identity preflight: trigger function name collision or drift';
  end if;
end $guard$;

-- Customer persistence, not user-editable metadata, establishes the canonical actor.
-- Explicit customer role is essential: the legacy profiles.role DEFAULT is admin.
create or replace function public.p0_customer_actor_profile()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if not exists(select 1 from auth.users where id=new.auth_user_id) then
    raise exception 'Canonical Customer Auth identity required';
  end if;
  insert into public.profiles(id,role,full_name,phone,created_at)
    values(new.auth_user_id,'customer',nullif(trim(concat_ws(' ',new.first_name,new.last_name)),''),
      coalesce(new.normalized_phone,new.phone),coalesce(new.created_at,now()))
    on conflict(id) do nothing;
  return new;
end $function$;
revoke all on function public.p0_customer_actor_profile() from public,anon,authenticated;

drop trigger if exists p0_customer_actor_profile on public.customers;
create trigger p0_customer_actor_profile after insert or update of auth_user_id on public.customers
  for each row execute function public.p0_customer_actor_profile();

insert into public.profiles(id,role,full_name,phone,created_at)
select c.auth_user_id,'customer',nullif(trim(concat_ws(' ',c.first_name,c.last_name)),''),
  coalesce(c.normalized_phone,c.phone),c.created_at
from public.customers c join auth.users u on u.id=c.auth_user_id
where not exists(select 1 from public.profiles p where p.id=c.auth_user_id)
on conflict(id) do nothing;

do $verify$
begin
  if exists(select 1 from public.customers c left join public.profiles p on p.id=c.auth_user_id where p.id is null) then
    raise exception 'P0 identity postflight: missing actor profiles remain';
  end if;
end $verify$;


-- P0 forward artifact. REVIEW ONLY; production requires separate approval.
-- Preserves the confirmed repair; adds exact normalized definition drift guards.
-- Changes only the INSERT inside phase5_create_trip. No row backfill or FK change.
-- CREATE OR REPLACE preserves the function identity, grants and transactional logic.
set local lock_timeout='5s';
set local statement_timeout='60s';

do $migration$
declare
  target regprocedure := 'public.phase5_create_trip(uuid,uuid,text,jsonb,bigint,text,bigint)'::regprocedure;
  definition text;
  original text := 'insert into public.trips select (jsonb_populate_record(null::public.trips,p_trip_payload)).* returning * into created;';
  replacement text := $replacement$
  -- phase5-booking-defaults-v1: omitted columns must use PostgreSQL defaults.
  p_trip_payload := p_trip_payload || jsonb_build_object(
    'offer_attempted_driver_ids',
    coalesce(nullif(p_trip_payload->'offer_attempted_driver_ids','null'::jsonb),'[]'::jsonb));
  execute (
    select format(
      'insert into public.trips (%s) select %s from jsonb_populate_record(null::public.trips,$1) as payload returning *',
      string_agg(format('%I',a.attname),',' order by a.attnum),
      string_agg(format('payload.%I',a.attname),',' order by a.attnum))
    from pg_catalog.pg_attribute a
    where a.attrelid='public.trips'::regclass and a.attnum>0 and not a.attisdropped
      and a.attgenerated='' and a.attidentity='' and p_trip_payload ? a.attname
  ) into created using p_trip_payload;
  $replacement$;
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid='public.trips'::regclass and attname='offer_attempted_driver_ids'
      and atttypid='uuid[]'::regtype and attnotnull and not attisdropped
  ) then
    raise exception 'Booking fix preflight failed: expected NOT NULL uuid[] attempted-driver column';
  end if;
  select replace(pg_get_functiondef(target),chr(13),'') into definition;
  if position('phase5-booking-defaults-v1' in definition)>0 then
    if md5(definition)<>'8e48e78ccab84188e8e20f4f1febf1bb' then
      raise exception 'P0 defaults preflight: repaired definition drifted';
    end if;
    raise notice 'Booking defaults fix already installed';
    return;
  end if;
  if md5(definition)<>'34d6dd39fac1d8cb1575a14b95eb3f74' then
    raise exception 'P0 defaults preflight: expected vulnerable definition changed';
  end if;
  if position(original in definition)=0 then
    raise exception 'Booking fix preflight failed: function INSERT has changed; review current function before applying';
  end if;
  if length(definition)-length(replace(definition,original,''))<>length(original) then
    raise exception 'Booking fix preflight failed: expected exactly one original INSERT';
  end if;
  execute replace(definition,original,replacement);
end $migration$;



-- REVIEW ONLY. Production requires separate approval. No policy/ledger/timing changes.
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
