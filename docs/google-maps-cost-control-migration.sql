-- REVIEW ONLY. Apply manually in the Supabase SQL Editor after review.
-- Adds cross-instance request leases, rate guards and aggregate telemetry.
-- It stores hashes and outcomes only, never Google Maps response content.

begin;

create table if not exists public.google_maps_request_log (
  id uuid primary key default gen_random_uuid(),
  operation text not null check (operation in ('route','geocode','reverse_geocode','autocomplete','place_details')),
  request_hash text not null,
  actor_hash text not null,
  status text not null check (status in ('in_flight','success','failure','blocked')),
  outcome_reason text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  lease_expires_at timestamptz null
);

create index if not exists google_maps_request_log_created_idx
  on public.google_maps_request_log (operation, created_at desc);
create index if not exists google_maps_request_log_actor_idx
  on public.google_maps_request_log (actor_hash, operation, created_at desc);
create index if not exists google_maps_request_log_lease_idx
  on public.google_maps_request_log (request_hash, lease_expires_at desc)
  where status = 'in_flight';

alter table public.google_maps_request_log enable row level security;
revoke all on public.google_maps_request_log from public, anon, authenticated;
grant select, insert, update on public.google_maps_request_log to service_role;

create or replace function public.guard_google_maps_request(
  p_operation text,
  p_request_hash text,
  p_actor_hash text,
  p_actor_limit integer,
  p_global_limit integer,
  p_lease_seconds integer default 8
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_actor_count integer;
  v_global_count integer;
begin
  if p_operation not in ('route','geocode','reverse_geocode','autocomplete','place_details') then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_operation');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operation || ':' || p_request_hash, 0));

  if exists (
    select 1 from public.google_maps_request_log
    where operation = p_operation
      and request_hash = p_request_hash
      and status = 'in_flight'
      and lease_expires_at > now()
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'duplicate_in_flight');
  end if;

  select count(*) into v_actor_count
  from public.google_maps_request_log
  where operation = p_operation and actor_hash = p_actor_hash
    and created_at >= now() - interval '1 minute'
    and status in ('in_flight','success');

  if v_actor_count >= greatest(1, p_actor_limit) then
    insert into public.google_maps_request_log(operation, request_hash, actor_hash, status, outcome_reason)
    values (p_operation, p_request_hash, p_actor_hash, 'blocked', 'actor_rate_limit');
    return jsonb_build_object('allowed', false, 'reason', 'actor_rate_limit');
  end if;

  select count(*) into v_global_count
  from public.google_maps_request_log
  where operation = p_operation and created_at >= now() - interval '1 minute'
    and status in ('in_flight','success');

  if v_global_count >= greatest(1, p_global_limit) then
    insert into public.google_maps_request_log(operation, request_hash, actor_hash, status, outcome_reason)
    values (p_operation, p_request_hash, p_actor_hash, 'blocked', 'global_circuit_open');
    return jsonb_build_object('allowed', false, 'reason', 'global_circuit_open');
  end if;

  insert into public.google_maps_request_log(
    operation, request_hash, actor_hash, status, lease_expires_at
  ) values (
    p_operation, p_request_hash, p_actor_hash, 'in_flight',
    now() + make_interval(secs => greatest(3, least(p_lease_seconds, 30)))
  ) returning id into v_id;

  return jsonb_build_object('allowed', true, 'request_id', v_id);
end;
$$;

create or replace function public.finish_google_maps_request(
  p_request_id uuid,
  p_outcome text,
  p_error_code text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.google_maps_request_log
  set status = case when p_outcome = 'success' then 'success' else 'failure' end,
      outcome_reason = nullif(left(coalesce(p_error_code, ''), 120), ''),
      completed_at = now(),
      lease_expires_at = null
  where id = p_request_id and status = 'in_flight';
end;
$$;

create or replace function public.google_maps_usage_summary(p_since timestamptz)
returns table(operation text, status text, request_count bigint)
language sql
security definer
set search_path = public
as $$
  select operation, status, count(*)
  from public.google_maps_request_log
  where created_at >= greatest(p_since, now() - interval '31 days')
  group by operation, status
  order by operation, status;
$$;

revoke all on function public.guard_google_maps_request(text,text,text,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.finish_google_maps_request(uuid,text,text) from public, anon, authenticated;
revoke all on function public.google_maps_usage_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.guard_google_maps_request(text,text,text,integer,integer,integer) to service_role;
grant execute on function public.finish_google_maps_request(uuid,text,text) to service_role;
grant execute on function public.google_maps_usage_summary(timestamptz) to service_role;

commit;
