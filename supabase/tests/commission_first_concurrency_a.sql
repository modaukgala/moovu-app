-- Verified disposable database only. Start B while this session sleeps.
-- Supply -v actor_id=... -v trip_id=... using a fresh eligible fixture.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','service_role',true);
select (public.commission_first_allocate(:'actor_id', :'trip_id', gen_random_uuid())).id as first_allocation \gset
\echo FIN04_A_READY
select pg_sleep(15);
commit;
\echo First allocation :first_allocation
