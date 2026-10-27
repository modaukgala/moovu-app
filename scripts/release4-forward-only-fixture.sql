-- Disposable database only. All synthetic rows and activation are rolled back.
begin;
set local request.jwt.claim.role = 'service_role';
do $$ begin
  if has_function_privilege('service_role', 'public.phase3_post_completed_online_driver_payable(uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.release4_post_forward_online_payable(uuid,timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.release4_post_forward_online_payable(uuid,timestamptz)', 'EXECUTE')
  then raise exception 'Forward-only RPC grants are unsafe'; end if;
end $$;

insert into auth.users(id) values ('00000000-0000-4000-8000-000000000011');
do $$ begin
  begin
    update public.online_payout_policy set effective_at=now()-interval '1 hour',
      activation_reference='synthetic-backdate-denied',
      activation_approved_by='00000000-0000-4000-8000-000000000011',
      activation_recorded_at=now()
    where policy_key='manual-online-payouts';
    raise exception 'Backdated activation was accepted';
  exception when raise_exception then
    if sqlerrm='Backdated activation was accepted' then raise; end if;
  end;
end $$;
update public.online_payout_policy set effective_at=now()+interval '1 hour',
  activation_reference='synthetic-approved-cutover',
  activation_approved_by='00000000-0000-4000-8000-000000000011',
  activation_recorded_at=now()
where policy_key='manual-online-payouts';
set local session_replication_role = replica;
insert into public.trips(id,pickup_address,dropoff_address,status,completed_at,payment_method)
values ('00000000-0000-4000-8000-000000000012','Fixture pickup','Fixture destination',
  'completed',now()-interval '1 day','online');
set local session_replication_role = origin;

do $$ declare v_cutoff timestamptz; v_result jsonb;
begin
  select effective_at into v_cutoff from public.online_payout_policy
    where policy_key='manual-online-payouts';
  v_result:=public.release4_post_forward_online_payable(
    '00000000-0000-4000-8000-000000000012',v_cutoff);
  if v_result->>'result' <> 'HISTORICAL_EXCLUDED' then
    raise exception 'Historical trip was admitted'; end if;
  begin
    perform public.release4_post_forward_online_payable(
      '00000000-0000-4000-8000-000000000012',v_cutoff+interval '1 second');
    raise exception 'Mismatched cutoff was accepted';
  exception when raise_exception then
    if sqlerrm='Mismatched cutoff was accepted' then raise; end if;
  end;
  begin
    update public.online_payout_policy set effective_at=v_cutoff+interval '1 second'
      where policy_key='manual-online-payouts';
    raise exception 'Activation cutoff was mutable';
  exception when raise_exception then
    if sqlerrm='Activation cutoff was mutable' then raise; end if;
  end;
end $$;
rollback;
