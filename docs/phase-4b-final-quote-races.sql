-- Disposable tangtlmdpnvmoviwrgvd only. Entire matrix rolls back.
begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare cu uuid:=gen_random_uuid(); du uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
  d uuid:=gen_random_uuid(); t uuid; q uuid; v jsonb; i integer;
begin
  insert into auth.users(id) values(cu),(du);
  insert into public.profiles(id,role) values(cu,'customer'),(du,'driver');
  insert into public.customers(id,auth_user_id) values(c,cu);
  insert into public.drivers(id,busy) values(d,true);
  insert into public.driver_accounts(user_id,driver_id) values(du,d);
  insert into public.phase4_policies(version,effective_from,free_seconds,no_show_seconds,
    go_late_cents,go_late_driver_cents,go_late_moovu_cents,
    xl_late_cents,xl_late_driver_cents,xl_late_moovu_cents,
    go_no_show_cents,go_no_show_driver_cents,go_no_show_moovu_cents,
    xl_no_show_cents,xl_no_show_driver_cents,xl_no_show_moovu_cents)
  values('phase4b-final-quotes',clock_timestamp()-interval '2 days',180,300,
    2000,1300,700,3000,2000,1000,3000,2200,800,4000,3000,1000);
  for i in 1..5 loop
    t:=gen_random_uuid();
    insert into public.trips(id,customer_id,driver_id,status,ride_option,created_at)
    values(t,c,case when i in (1,3,4,5) then d else null end,
      case when i=2 then 'offered' else 'assigned' end,'go',
      clock_timestamp()-case when i=1 then interval '179.6 seconds' else interval '5 minutes' end);
    v:=public.phase4b_quote_customer_cancellation(t,c,cu); q:=(v->>'quote_id')::uuid;
    if i=1 then perform pg_sleep(0.7); end if;
    if i=2 then update public.trips set driver_id=d,status='assigned' where id=t; end if;
    if i=3 then update public.trips set driver_id=null,status='offered' where id=t; end if;
    if i=4 then
      update public.phase4b_cancellation_quotes
        set issued_at=clock_timestamp()-interval '35 seconds',
            expires_at=clock_timestamp()-interval '6 seconds' where id=q;
    end if;
    if i=5 then
      update public.trips set status='arrived',driver_arrived_at=clock_timestamp(),
        arrival_evidence_qualified=true,arrival_evidence_version='phase-05b-v1' where id=t;
    end if;
    v:=public.phase4b_cancel_customer_trip(t,c,cu,q,'test',null);
    if coalesce((v->>'requires_reconfirmation')::boolean,false) is not true
      or (select status from public.trips where id=t)='cancelled' then
      raise exception 'Quote race % failed: %',i,v;
    end if;
  end loop;
end $$;
select 'five_quote_races_passed' result;
rollback;
