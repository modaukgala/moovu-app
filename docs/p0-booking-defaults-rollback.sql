-- Approval required. Restores the vulnerable INSERT without changing existing rows.
begin;
set local lock_timeout='5s';
do $rollback$
declare target regprocedure:='public.phase5_create_trip(uuid,uuid,text,jsonb,bigint,text,bigint)'::regprocedure;
  definition text;
  repaired text:=$repaired$
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
  $repaired$;
begin
  definition:=replace(pg_get_functiondef(target),chr(13),'');
  if md5(definition)<>'8e48e78ccab84188e8e20f4f1febf1bb' then
    raise exception 'P0 defaults rollback: expected repaired definition changed';
  end if;
  if position(repaired in definition)=0 then raise exception 'P0 defaults rollback: INSERT anchor changed'; end if;
  execute replace(definition,repaired,'insert into public.trips select (jsonb_populate_record(null::public.trips,p_trip_payload)).* returning * into created;');
  if md5(replace(pg_get_functiondef(target),chr(13),''))<>'34d6dd39fac1d8cb1575a14b95eb3f74' then
    raise exception 'P0 defaults rollback: baseline mismatch';
  end if;
end $rollback$;
commit;
