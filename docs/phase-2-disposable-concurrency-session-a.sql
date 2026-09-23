-- DISPOSABLE ONLY: tangtlmdpnvmoviwrgvd. Fixture from concurrency setup on 2026-09-10.
-- Run Session B while this session holds the request lock for 20 seconds.
begin;
set local statement_timeout='55s';
create temporary table phase2_session_result(pid integer,started_at timestamptz,finished_at timestamptz,legacy jsonb,shadow jsonb);
do $$ declare started timestamptz:=clock_timestamp(); legacy jsonb; shadow jsonb;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform 1 from public.driver_payment_requests where id='3a9a30fa-bce8-4aa6-8269-5ae45d8b3f96' for update;
  perform pg_sleep(20);
  legacy:=public.phase05b_review_driver_payment('3a9a30fa-bce8-4aa6-8269-5ae45d8b3f96','approve',null,'b0935e58-77d0-4dab-9d97-4085831bd44d');
  shadow:=public.phase2_post_verified_driver_payment('3a9a30fa-bce8-4aa6-8269-5ae45d8b3f96','b0935e58-77d0-4dab-9d97-4085831bd44d');
  insert into phase2_session_result values(pg_backend_pid(),started,clock_timestamp(),legacy,shadow);
end $$;
select * from phase2_session_result;
commit;
