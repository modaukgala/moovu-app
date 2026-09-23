-- Disposable tangtlmdpnvmoviwrgvd only. Inject five persistence failures; rollback all fixtures/DDL.
begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.phase4b_forced_failure() returns trigger language plpgsql as $$
begin raise exception 'phase4b injected persistence failure'; end $$;
do $$
declare cu uuid:=gen_random_uuid();du uuid:=gen_random_uuid();c uuid:=gen_random_uuid();
 d uuid:=gen_random_uuid();t uuid;q uuid;v jsonb; target text; failed boolean;
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
 values('phase4b-final-faults',clock_timestamp()-interval '2 days',180,300,
   2000,1300,700,3000,2000,1000,3000,2200,800,4000,3000,1000);
 foreach target in array array['phase4_customer_liabilities','phase4_driver_compensations',
   'financial_transactions','moovu_business_events','moovu_notification_outbox'] loop
   t:=gen_random_uuid();
   insert into public.trips(id,customer_id,driver_id,status,ride_option,created_at)
     values(t,c,d,'assigned','go',clock_timestamp()-interval '5 minutes');
   v:=public.phase4b_quote_customer_cancellation(t,c,cu);q:=(v->>'quote_id')::uuid;
   execute format('create trigger phase4b_forced_failure before insert on public.%I for each row execute function pg_temp.phase4b_forced_failure()',target);
   failed:=false;
   begin
     perform public.phase4b_cancel_customer_trip(t,c,cu,q,'test',null);
   exception when others then
     if sqlerrm not like '%phase4b injected persistence failure%' then raise; end if;
     failed:=true;
   end;
   execute format('drop trigger phase4b_forced_failure on public.%I',target);
   if not failed or (select status from public.trips where id=t)<>'assigned'
     or exists(select 1 from public.phase4_fee_assessments where trip_id=t)
     or exists(select 1 from public.financial_transactions where economic_trip_id=t)
     or exists(select 1 from public.moovu_business_events where aggregate_id=t and event_key like 'phase4:%')
   then raise exception 'Atomic rollback failed at %',target;end if;
 end loop;
end $$;
select 'five_atomic_faults_passed' result;
rollback;
