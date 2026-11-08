-- REVIEW CANDIDATE ONLY. Not part of automatic application migrations.
-- Requires hosted pg_cron >= 1.6 and pg_net, reviewed installation permissions,
-- a certified rollback/drain build, and explicit production release approval.
-- Provision Vault secret moovu_dispatch_worker_secret privately; its value must
-- match the existing server DISPATCH_JOB_SECRET. Never put it into this file.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
 if not exists(select 1 from pg_extension where extname='pg_cron')
 or not exists(select 1 from pg_extension where extname='pg_net') then
  raise exception 'Reviewed pg_cron and pg_net installation required';
 end if;
 if (select count(*) from vault.decrypted_secrets where name='moovu_dispatch_worker_secret')<>1 then
  raise exception 'Exactly one privately provisioned worker secret is required';
 end if;
end $$;

create schema if not exists moovu_worker_private;
revoke all on schema moovu_worker_private from public,anon,authenticated,service_role;
create table if not exists moovu_worker_private.http_invocations(
 request_id bigint primary key,
 worker text not null check(worker in('broadcast','dispatch')),
 invoked_at timestamptz not null default clock_timestamp()
);
create index if not exists moovu_worker_http_invoked_at on moovu_worker_private.http_invocations(invoked_at);
alter table moovu_worker_private.http_invocations enable row level security;
revoke all on moovu_worker_private.http_invocations from public,anon,authenticated,service_role;

create or replace function moovu_worker_private.invoke_dispatch_workers() returns void
language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare credential text; bypass text; request_headers jsonb; endpoint text; request_id bigint; work text;
begin
 if not pg_try_advisory_xact_lock(61061108,1) then return;end if;
 select decrypted_secret into strict credential from vault.decrypted_secrets
  where name='moovu_dispatch_worker_secret';
 select decrypted_secret into bypass from vault.decrypted_secrets
  where name='moovu_dispatch_worker_bypass';
 request_headers:=jsonb_build_object('Authorization','Bearer '||credential,'Content-Type','application/json');
 if bypass is not null then request_headers:=request_headers||jsonb_build_object('x-vercel-protection-bypass',bypass);end if;
 for work in
  select 'broadcast' where exists(
   select 1 from public.driver_broadcast_requests where state in('PENDING','ACTIVE')
    and next_run_at<=clock_timestamp() and (lease_until is null or lease_until<clock_timestamp()))
   or exists(select 1 from public.driver_offer_device_jobs where expires_at>clock_timestamp()
    and ((state='PENDING' and next_run_at<=clock_timestamp()) or (state='SENDING' and lease_until<clock_timestamp())))
  union all
  select 'dispatch' where exists(select 1 from public.dispatch_jobs
   where status='pending' and run_at<=clock_timestamp())
 loop
  endpoint:='https://moovurides.co.za/api/jobs/'||work;
  select net.http_post(url:=endpoint,
   headers:=request_headers,
   body:='{}'::jsonb,timeout_milliseconds:=15000) into request_id;
  insert into moovu_worker_private.http_invocations(request_id,worker) values(request_id,work);
 end loop;
 delete from moovu_worker_private.http_invocations where invoked_at<clock_timestamp()-interval '1 day';
end $$;
revoke all on function moovu_worker_private.invoke_dispatch_workers() from public,anon,authenticated,service_role;
-- This named schedule is idempotently replaced by pg_cron. Its owner must be the
-- reviewed database operator; application roles cannot invoke the private helper.
select cron.schedule('moovu-dispatch-workers-10s','10 seconds',
 'select moovu_worker_private.invoke_dispatch_workers()');
commit;

-- Disable new broadcast capture first, then drain existing requests/jobs using
-- the compatible recovery application. Unschedule only after a verified drain:
-- select cron.unschedule('moovu-dispatch-workers-10s');
-- Keep invocation evidence until reviewed. Inspect net._http_response by
-- request_id for status_code/timed_out/error_msg; never select queued headers.
