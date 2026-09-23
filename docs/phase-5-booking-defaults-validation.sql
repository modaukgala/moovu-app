-- Run ONLY on an approved local/disposable database, never production.
-- This is a SQL-mechanism regression test, not a real booking/dispatch E2E.
-- All test data is temporary and the transaction is rolled back.
begin;
create temporary table booking_default_probe (
  id uuid primary key default gen_random_uuid(),
  pickup_address text not null,
  offer_attempted_driver_ids uuid[] not null default '{}'::uuid[],
  issue_reported boolean not null default false,
  cancellation_fee_amount numeric not null default 0,
  dispatch_priority_score numeric not null default 0,
  completed_without_end_otp boolean not null default false
);

do $test$
declare
  p_trip_payload jsonb;
  created pg_temp.booking_default_probe;
  mode integer;
begin
  for mode in 1..3 loop
    p_trip_payload := jsonb_build_object('pickup_address','mechanism-test');
    if mode=2 then
      p_trip_payload := p_trip_payload || '{"offer_attempted_driver_ids":null}'::jsonb;
    elsif mode=3 then
      p_trip_payload := p_trip_payload || '{"offer_attempted_driver_ids":[],"issue_reported":true,"cancellation_fee_amount":15}'::jsonb;
    end if;
    p_trip_payload := p_trip_payload || jsonb_build_object(
      'offer_attempted_driver_ids',
      coalesce(nullif(p_trip_payload->'offer_attempted_driver_ids','null'::jsonb),'[]'::jsonb));
    execute (
      select format(
        'insert into pg_temp.booking_default_probe (%s) select %s from jsonb_populate_record(null::pg_temp.booking_default_probe,$1) as payload returning *',
        string_agg(format('%I',a.attname),',' order by a.attnum),
        string_agg(format('payload.%I',a.attname),',' order by a.attnum))
      from pg_catalog.pg_attribute a
      where a.attrelid='pg_temp.booking_default_probe'::regclass and a.attnum>0 and not a.attisdropped
        and a.attgenerated='' and a.attidentity='' and p_trip_payload ? a.attname
    ) into created using p_trip_payload;
    if created.id is null or created.offer_attempted_driver_ids is distinct from '{}'::uuid[]
      or created.dispatch_priority_score is distinct from 0::numeric
      or created.completed_without_end_otp is distinct from false then
      raise exception 'Default preservation failed for case %',mode;
    end if;
    if mode<3 and (created.issue_reported is distinct from false or created.cancellation_fee_amount is distinct from 0::numeric) then
      raise exception 'Missing-column defaults failed';
    end if;
    if mode=3 and (created.issue_reported is distinct from true or created.cancellation_fee_amount is distinct from 15::numeric) then
      raise exception 'Supplied values were overwritten';
    end if;
  end loop;
  begin
    insert into pg_temp.booking_default_probe(pickup_address,offer_attempted_driver_ids)
    values('constraint-test',null);
    raise exception 'NOT NULL protection unexpectedly removed';
  exception when not_null_violation then null;
  end;
  raise notice 'Booking default mechanism tests passed';
end $test$;
rollback;
