-- MOOVU all-driver dispatch and audited admin recovery (REVIEW/APPLY IN SQL EDITOR)
-- Additive and backward-compatible. Apply after docs/atomic-dispatch-migration.sql.

alter table public.trips
  add column if not exists auto_cancel_at timestamptz,
  add column if not exists completed_by text,
  add column if not exists admin_completion_reason text,
  add column if not exists admin_completion_note text;

create or replace function public.set_dispatch_deadline()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.dispatch_started_at is not null then
    new.auto_cancel_at := coalesce(new.auto_cancel_at, new.dispatch_started_at + interval '5 minutes');
  end if;
  return new;
end;
$$;

drop trigger if exists set_dispatch_deadline_trigger on public.trips;
create trigger set_dispatch_deadline_trigger
before insert or update of dispatch_started_at on public.trips
for each row execute function public.set_dispatch_deadline();

update public.trips
set auto_cancel_at = dispatch_started_at + interval '5 minutes'
where dispatch_started_at is not null and auto_cancel_at is null;

create or replace function public.mark_dispatch_exhausted(p_trip_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_trip public.trips%rowtype;
begin
  select * into v_trip from public.trips where id=p_trip_id for update;
  if not found or v_trip.status not in ('requested','offered') or v_trip.driver_id is not null then
    return;
  end if;
  if coalesce(v_trip.dispatch_started_at, v_trip.created_at) + interval '5 minutes' > now() then
    return;
  end if;

  update public.trips set
    status='cancelled', driver_id=null, offer_status=null, offer_expires_at=null,
    dispatch_state='cancelled', dispatch_failure_reason='No driver accepted within 5 minutes',
    cancellation_reason='No driver accepted within 5 minutes',
    cancel_reason='No available driver accepted within 5 minutes.',
    cancelled_by='system', cancelled_at=now(), dispatch_updated_at=now()
  where id=p_trip_id and status in ('requested','offered') and driver_id is null;

  update public.driver_trip_offers set status='cancelled',cancelled_at=now(),updated_at=now()
  where trip_id=p_trip_id and status in ('pending','shown');
  update public.dispatch_jobs set status='cancelled',updated_at=now()
  where trip_id=p_trip_id and status in ('pending','processing');
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status)
  values(p_trip_id,'trip_auto_cancelled','No driver accepted within 5 minutes',v_trip.status,'cancelled');
end;
$$;

revoke all on function public.mark_dispatch_exhausted(uuid) from public, anon, authenticated;
grant execute on function public.mark_dispatch_exhausted(uuid) to service_role;
