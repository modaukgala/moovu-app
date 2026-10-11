-- A matching window records its outcome independently of later trip status.
-- This applies only to trips with an opt-in 90-second matching window.
alter table public.dispatch_matching_windows
  drop constraint dispatch_matching_windows_state_check,
  drop constraint dispatch_matching_windows_check1;

alter table public.dispatch_matching_windows
  add constraint dispatch_matching_windows_state_check
    check (state in ('SEARCHING', 'MATCHED', 'UNMATCHED', 'CANCELLED')),
  add constraint dispatch_matching_windows_check1
    check ((state = 'SEARCHING' and completed_at is null)
       or (state <> 'SEARCHING' and completed_at is not null));

create function public.finish_dispatch_matching_on_trip_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.driver_id is not null and new.status in ('assigned', 'arrived', 'ongoing', 'completed', 'cancelled') then
    update public.dispatch_matching_windows
       set state = 'MATCHED', completed_at = clock_timestamp()
     where trip_id = new.id and state = 'SEARCHING';
  elsif new.status in ('cancelled', 'expired', 'completed', 'no_show')
    and not (new.status = 'cancelled' and new.cancelled_by = 'system'
      and new.cancellation_type = 'dispatch_expiry') then
    update public.dispatch_matching_windows
       set state = 'CANCELLED', completed_at = clock_timestamp()
     where trip_id = new.id and state = 'SEARCHING';
  end if;
  return new;
end;
$$;

create trigger finish_dispatch_matching_on_trip_transition
after update of driver_id, status on public.trips
for each row when (old.driver_id is distinct from new.driver_id
  or old.status is distinct from new.status)
execute function public.finish_dispatch_matching_on_trip_transition();

create function public.guard_dispatch_matching_terminal_reopen()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state <> 'SEARCHING' and new.state is distinct from old.state then
    raise exception 'Terminal matching outcome cannot change' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger guard_dispatch_matching_terminal_reopen
before update of state on public.dispatch_matching_windows
for each row execute function public.guard_dispatch_matching_terminal_reopen();

-- Preserve existing matching history while closing only already-terminal trips.
update public.dispatch_matching_windows w
   set state = case when t.driver_id is not null then 'MATCHED' else 'CANCELLED' end,
       completed_at = coalesce(t.cancelled_at, t.completed_at, clock_timestamp())
  from public.trips t
 where t.id = w.trip_id and w.state = 'SEARCHING'
   and (t.status in ('assigned', 'arrived', 'ongoing', 'completed', 'cancelled', 'expired', 'no_show')
     or t.driver_id is not null)
   and not (t.status = 'cancelled' and t.driver_id is null
     and t.cancelled_by = 'system' and t.cancellation_type = 'dispatch_expiry');
