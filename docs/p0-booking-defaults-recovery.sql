-- P0 forward artifact. REVIEW ONLY; production requires separate approval.
-- Preserves the confirmed repair; adds exact normalized definition drift guards.
-- Changes only the INSERT inside phase5_create_trip. No row backfill or FK change.
-- CREATE OR REPLACE preserves the function identity, grants and transactional logic.
begin;
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

commit;
