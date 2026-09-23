-- DISPOSABLE ONLY: tangtlmdpnvmoviwrgvd. Test data rolls back.
-- Requires the corrected Phase 2 migration and verified SQL Editor target.
begin;
create temporary table phase2_security_results(check_name text, result text);
do $$
declare r record;
begin
  for r in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'phase2_%'
  loop
    if exists(select 1 from aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
      or has_function_privilege('anon',r.oid,'EXECUTE') or has_function_privilege('authenticated',r.oid,'EXECUTE')
    then raise exception 'Client execute exposed: %',r.proname; end if;
    if has_function_privilege('service_role',r.oid,'EXECUTE') is distinct from
      (r.proname not in ('phase2_snapshot_new_trip','phase2_guard_trip_commission_snapshot',
        'phase2_guard_finance_policy_cutoff','phase2_assert_driver_commission_debt_floor'))
    then raise exception 'Unexpected service permission: %',r.proname; end if;
    if not ('search_path=public, pg_temp'=any(r.proconfig)) then raise exception 'Unsafe search path'; end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'phase2_%')<>11
    then raise exception 'Function inventory differs'; end if;
  insert into phase2_security_results values('eleven-function effective permission matrix','PASS');
end $$;

create function pg_temp.phase2_financial_fingerprint() returns jsonb language plpgsql as $$
declare v_result jsonb:='{}'; v_table text; v_hash text;
begin
  foreach v_table in array array['financial_accounts','financial_transactions','financial_ledger_entries',
    'driver_wallets','driver_wallet_transactions','driver_settlements','driver_payment_requests',
    'phase2_shadow_reconciliations','moovu_business_events','moovu_notification_outbox']
  loop
    execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,''|'' order by to_jsonb(t)::text),'''')) from public.%I t',v_table) into v_hash;
    v_result:=v_result||jsonb_build_object(v_table,v_hash);
  end loop;
  return v_result;
end $$;

do $$
declare v_role text; v_actor uuid; v_before jsonb; v_denied boolean; v_error text;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  foreach v_role in array array['MISSING_ID','MISSING_PROFILE','','unknown','customer','driver','dispatcher','support']
  loop
    v_actor:=case when v_role='MISSING_ID' then null else gen_random_uuid() end;
    if v_role not in ('MISSING_ID','MISSING_PROFILE') then
      insert into auth.users(id) values(v_actor);
      insert into public.profiles(id,role) values(v_actor,v_role);
    end if;
    v_before:=pg_temp.phase2_financial_fingerprint(); v_denied:=false;
    begin
      perform public.phase2_post_verified_driver_payment('a2000000-0000-0000-0000-000000000001',v_actor);
    exception when raise_exception then
      get stacked diagnostics v_error=message_text;
      if v_error not in ('Owner or Admin actor identity required','Owner or Admin actor required') then raise; end if;
      v_denied:=true;
    end;
    if not v_denied or v_before is distinct from pg_temp.phase2_financial_fingerprint() then
      raise exception 'Authorization/zero-mutation failure for %',v_role;
    end if;
    insert into phase2_security_results values('actor '||coalesce(nullif(v_role,''),'EMPTY_ROLE'),'DENIED; zero mutation');
  end loop;
end $$;

-- Check the actual SQL role, not only catalog grants. No financial fixtures yet.
set local role anon;
do $$ begin
  begin
    perform public.phase2_post_verified_driver_payment(null,null);
    raise exception 'Anon unexpectedly invoked financial RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.phase2_post_verified_driver_payment(null,null);
    raise exception 'Authenticated unexpectedly invoked financial RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into phase2_security_results values('actual anon/authenticated RPC calls','DENIED');
select * from phase2_security_results order by check_name;
rollback;
