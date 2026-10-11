-- DISPOSABLE ONLY: synthetic E2E job isolation. Never apply to production.
-- The normal claim_due_dispatch_jobs function and historical queue are unchanged.
create function public.claim_due_synthetic_dispatch_job(p_job_id uuid)
returns setof public.dispatch_jobs
language plpgsql security definer set search_path = ''
as $$
declare
  v_job_id uuid;
  v_attempts integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted server role required';
  end if;
  select j.id,j.attempts into v_job_id,v_attempts
  from public.dispatch_jobs j
  join public.trips t on t.id=j.trip_id
  join public.customers c on c.id=t.customer_id
  join auth.users u on u.id=c.auth_user_id
  where j.id=p_job_id and j.status='pending' and j.run_at<=clock_timestamp()
    and j.job_type in ('recover','expire','escalate')
    and u.email like 'dispatch-90-customer-%@example.com'
  for update of j skip locked;
  if v_job_id is null then return; end if;
  if v_attempts>=5 then
    update public.dispatch_jobs set status='failed',locked_at=null,
      last_error=coalesce(last_error,'Dispatch retry limit reached'),
      updated_at=clock_timestamp() where id=v_job_id;
    return;
  end if;
  return query update public.dispatch_jobs j
  set status='processing',locked_at=clock_timestamp(),attempts=j.attempts+1,
    updated_at=clock_timestamp()
  where j.id=v_job_id returning j.*;
end;
$$;
revoke all on function public.claim_due_synthetic_dispatch_job(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_due_synthetic_dispatch_job(uuid) to service_role;
