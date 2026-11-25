-- Verified disposable database only. Start during A's sleep, using its inputs.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
set local lock_timeout = '2s';
select set_config('request.jwt.claim.role','service_role',true);
select set_config('fin04.test.actor', :'actor_id', true);
select set_config('fin04.test.trip', :'trip_id', true);
do $$
begin
  perform public.commission_first_allocate(current_setting('fin04.test.actor')::uuid,
    current_setting('fin04.test.trip')::uuid, gen_random_uuid());
  raise exception 'Competing allocation failed to wait for session A';
exception when lock_not_available then null;
end $$;
set local lock_timeout = '25s';
select (public.commission_first_allocate(:'actor_id', :'trip_id', gen_random_uuid())).id as replay_allocation;
commit;
