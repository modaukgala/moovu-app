-- REVIEW ONLY. Do not run against production before verification and staging QA.
-- Requires the existing atomic dispatch schema. No tables, rows, policies or offers are removed.
-- Application MAX_DISPATCH_ATTEMPTS is 5; keep the SQL contract aligned.
begin;

create or replace function public.guard_dispatch_job_retry()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
declare
  retry_seconds integer;
begin
  -- An old worker/upsert or recovery script must not revive a terminal job.
  if old.status in ('completed', 'failed', 'cancelled')
     and new.status in ('pending', 'processing') then
    return null;
  end if;
  if new.attempts < old.attempts then
    raise exception 'Dispatch attempts cannot decrease';
  end if;
  if new.status = 'pending' and new.attempts >= 5 then
    new.status := 'failed';
    new.locked_at := null;
    new.last_error := coalesce(new.last_error, 'Dispatch retry limit reached');
  elsif old.status = 'processing' and new.status = 'pending' then
    retry_seconds := case new.attempts when 1 then 10 when 2 then 30 when 3 then 60 when 4 then 120 else 10 end;
    new.run_at := greatest(new.run_at, now() + make_interval(secs => retry_seconds));
    new.locked_at := null;
  end if;
  return new;
end;
$$;

-- Re-runnable without dropping any existing production trigger.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'dispatch_job_retry_guard'
    and tgrelid = 'public.dispatch_jobs'::regclass and not tgisinternal) then
    create trigger dispatch_job_retry_guard before update on public.dispatch_jobs
      for each row execute function public.guard_dispatch_job_retry();
  end if;
end;
$$;

create or replace function public.claim_due_dispatch_jobs(p_limit integer default 20)
returns setof public.dispatch_jobs
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- Bounded cleanup, using row locks just like the claim. Active final attempts
  -- are deliberately not failed here: attempt five may still succeed.
  with exhausted as (
    select id from public.dispatch_jobs
    where status = 'pending' and attempts >= 5 and run_at <= now()
    order by run_at, id limit greatest(1, least(100, p_limit))
    for update skip locked
  )
  update public.dispatch_jobs j set status = 'failed', locked_at = null,
    last_error = coalesce(j.last_error, 'Dispatch retry limit reached'), updated_at = now()
  from exhausted where j.id = exhausted.id;

  return query
  with due as (
    select id from public.dispatch_jobs
    where status = 'pending' and run_at <= now() and attempts < 5
    order by run_at, id limit greatest(1, least(100, p_limit))
    for update skip locked
  )
  update public.dispatch_jobs j
    set status = 'processing', locked_at = now(), attempts = j.attempts + 1, updated_at = now()
  from due where j.id = due.id returning j.*;
end;
$$;

revoke all on function public.guard_dispatch_job_retry() from public, anon, authenticated;
revoke all on function public.claim_due_dispatch_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_due_dispatch_jobs(integer) to service_role;
commit;

-- Order: review -> staging SQL -> verify -> retry/concurrency staging tests ->
-- controlled production SQL -> verify definition -> deploy app -> smoke tests.
-- Rollback: retain this safety guard while rolling back app code. Replacing it
-- with the old uncapped claim reintroduces the outage risk; requires explicit review.
