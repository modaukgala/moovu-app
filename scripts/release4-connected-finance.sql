-- Runs only in the disposable, schema-only local clone. Every fixture is rolled back.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() <> 'release4_finance_20261020' then
    raise exception 'Release 4 tests require the isolated local database';
  end if;
end $$;
select set_config('request.jwt.claim.role','service_role',true);

insert into public.phase2_finance_policy(policy_key,mode,go_basis_points,go_xl_basis_points,
  debt_limit_cents,warning_cents,subscription_required,effective_from,authoritative_effective_from)
values('phase2-driver-finance','AUTHORITATIVE',1500,1500,5000,4000,false,now()-interval '1 day',now()-interval '1 day');
insert into auth.users(id,email) values
  ('a4000000-0000-4000-8000-000000000001','release4-customer@example.invalid'),
  ('a4000000-0000-4000-8000-000000000002','release4-driver@example.invalid');
insert into public.profiles(id,role) values
  ('a4000000-0000-4000-8000-000000000001','customer'),
  ('a4000000-0000-4000-8000-000000000002','driver');
insert into public.customers(id,auth_user_id,first_name,last_name,phone,normalized_phone)
values('a4100000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  'Release','Four','+27900000041','+27900000041');
insert into public.drivers(id,first_name,last_name,phone,status,verification_status,profile_completed)
values('a4200000-0000-4000-8000-000000000001','Release','Four','+27900000042',
  'approved','approved',true);
insert into public.driver_accounts(user_id,driver_id)
values('a4000000-0000-4000-8000-000000000002','a4200000-0000-4000-8000-000000000001');
insert into public.driver_wallets(driver_id,balance_due)
values('a4200000-0000-4000-8000-000000000001',0);

insert into public.trips(id,customer_id,pickup_address,dropoff_address,status,payment_method,
  fare_amount,final_fare,original_fare,estimated_fare,ride_option)
values('a4300000-0000-4000-8000-000000000001','a4100000-0000-4000-8000-000000000001',
  'Synthetic pickup','Synthetic destination','requested','cash',76,76,76,76,'go');
do $$ declare t public.trips; begin
  select * into strict t from public.trips where id='a4300000-0000-4000-8000-000000000001';
  if t.final_fare<>76 or t.commission_basis_points<>1500 then
    raise exception 'Legacy fare or commission snapshot mismatch';
  end if;
end $$;
\echo CONNECTED_LEGACY_BOOKING_SNAPSHOT_PASS

insert into public.trips(id,customer_id,driver_id,pickup_address,dropoff_address,status,
  completed_at,payment_method,fare_amount,final_fare,original_fare,estimated_fare,
  ride_option,commission_amount,driver_net_earnings)
values('a4300000-0000-4000-8000-000000000002','a4100000-0000-4000-8000-000000000001',
  'a4200000-0000-4000-8000-000000000001','Synthetic pickup','Synthetic destination',
  'completed',now(),'cash',77.75,77.75,77.75,77.75,'go',11.66,66.09);
\if :{?R4_CONCURRENCY_SETUP}
commit;
\echo CONNECTED_SYNTHETIC_CONCURRENCY_FIXTURE_READY
\else
do $$ declare first_result jsonb; replay_result jsonb; entry_count integer;
  debit_cents bigint; credit_cents bigint; begin
  first_result:=public.phase2_post_trip_commission('a4300000-0000-4000-8000-000000000002',
    'a4000000-0000-4000-8000-000000000001');
  replay_result:=public.phase2_post_trip_commission('a4300000-0000-4000-8000-000000000002',
    'a4000000-0000-4000-8000-000000000001');
  select count(*),coalesce(sum(case when e.entry_side='DEBIT' then e.amount_cents end),0),
    coalesce(sum(case when e.entry_side='CREDIT' then e.amount_cents end),0)
    into entry_count,debit_cents,credit_cents
  from public.financial_ledger_entries e join public.financial_transactions ft on ft.id=e.transaction_id
  where ft.idempotency_key='trip_commission:a4300000-0000-4000-8000-000000000002';
  if (first_result->>'commission_cents')::bigint<>1166 or
    (replay_result->>'commission_cents')::bigint<>1166 or entry_count<>2 or
    debit_cents<>1166 or credit_cents<>1166 or
    (select count(*) from public.financial_transactions
      where idempotency_key='trip_commission:a4300000-0000-4000-8000-000000000002')<>1 then
    raise exception 'Commission posting or replay mismatch';
  end if;
end $$;
\echo CONNECTED_COMMISSION_POSTING_REPLAY_PASS
rollback;
\endif
