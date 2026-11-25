-- Verified disposable database only. Run as session B while session A holds
-- the allocation transaction open. Use a fixture with positive pre-allocation
-- debt and zero debt remaining after allocation. Supply actor_id and driver_id.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
set local lock_timeout = '2s';
select set_config('request.jwt.claim.role','service_role',true);
select set_config('fin04.test.actor', :'actor_id', true);
select set_config('fin04.test.driver', :'driver_id', true);
do $$
begin
  perform public.phase05b_record_settlement('fin04-test:' || gen_random_uuid(),
    current_setting('fin04.test.driver')::uuid, 0.01, 'eft', 'Synthetic settlement', null,
    current_setting('fin04.test.actor')::uuid);
  raise exception 'Settlement did not contend with allocation';
exception when lock_not_available then null;
end $$;
set local lock_timeout = '25s';
do $$
begin
  perform public.phase05b_record_settlement('fin04-test:' || gen_random_uuid(),
    current_setting('fin04.test.driver')::uuid, 0.01, 'eft', 'Synthetic settlement', null,
    current_setting('fin04.test.actor')::uuid);
  raise exception 'Settlement over-recovered debt';
exception when raise_exception then
  if sqlerrm <> 'Settlement exceeds current commission due' then raise; end if;
end $$;
rollback;
