-- A narrow admission boundary. Existing trips and verified payment processing
-- remain writable; this is not a database-wide write freeze.
create table public.moovu_admission_state (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'NORMAL' check (mode in ('NORMAL', 'MAINTENANCE')),
  revision bigint not null default 0,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  reason text not null default 'Initial normal operation'
);
insert into public.moovu_admission_state(singleton) values (true);

create table public.moovu_admission_audit (
  id bigint generated always as identity primary key,
  old_mode text not null,
  new_mode text not null,
  actor uuid not null,
  reason text not null,
  changed_at timestamptz not null default now()
);

alter table public.moovu_admission_state enable row level security;
alter table public.moovu_admission_audit enable row level security;
revoke all on public.moovu_admission_state, public.moovu_admission_audit from public, anon, authenticated, service_role;
revoke all on sequence public.moovu_admission_audit_id_seq from public, anon, authenticated, service_role;
grant select on public.moovu_admission_state, public.moovu_admission_audit to service_role;

-- FOR SHARE holds the state row until the admission transaction commits.
-- A transition UPDATE waits for all in-flight inserts; inserts starting after
-- the transition see MAINTENANCE. Trigger execution also covers service_role,
-- SECURITY DEFINER booking functions and direct PostgREST inserts.
create function public.moovu_admission_insert_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare current_mode text;
begin
  select mode into current_mode from public.moovu_admission_state
    where singleton = true for share;
  if current_mode is distinct from 'NORMAL' then
    raise exception 'MOOVU_ADMISSION_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger moovu_admission_trip_insert
  before insert on public.trips for each row
  execute function public.moovu_admission_insert_guard();
create trigger moovu_admission_customer_attempt_insert
  before insert on public.online_payment_attempts for each row
  execute function public.moovu_admission_insert_guard();
create trigger moovu_admission_driver_attempt_insert
  before insert on public.driver_online_payment_attempts for each row
  execute function public.moovu_admission_insert_guard();

-- The server authenticates the caller; the database independently requires
-- the actor to remain an Owner. Only the server's service role can invoke it.
create function public.moovu_admission_transition(
  p_target text, p_actor uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous text; next_revision bigint; unfinished bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Maintenance authority required' using errcode = '42501';
  end if;
  if p_target not in ('NORMAL', 'MAINTENANCE')
      or length(btrim(coalesce(p_reason, ''))) not between 8 and 500
      or not exists (select 1 from public.profiles
        where id = p_actor and role = 'owner') then
    raise exception 'Owner, valid mode and reason required' using errcode = '42501';
  end if;

  select mode into previous from public.moovu_admission_state
    where singleton = true for update;
  if previous is null or previous = p_target then
    raise exception 'Invalid maintenance transition' using errcode = '22023';
  end if;
  if p_target = 'MAINTENANCE' then
    -- CREATED means a provider call may still be in flight. Refuse to close
    -- admission until each such attempt is reconciled or bound to a checkout.
    select
      (select count(*) from public.online_payment_attempts where state = 'CREATED') +
      (select count(*) from public.driver_online_payment_attempts where state = 'CREATED')
      into unfinished;
    if unfinished <> 0 then
      raise exception 'Unbound checkout attempts require reconciliation'
        using errcode = 'P0001';
    end if;
  end if;

  update public.moovu_admission_state set mode = p_target,
    revision = revision + 1, changed_at = now(),
    changed_by = p_actor, reason = btrim(p_reason)
    where singleton = true returning revision into next_revision;
  insert into public.moovu_admission_audit(old_mode, new_mode, actor, reason)
    values (previous, p_target, p_actor, btrim(p_reason));
  return jsonb_build_object('mode', p_target, 'revision', next_revision);
end $$;

revoke all on function public.moovu_admission_insert_guard(),
  public.moovu_admission_transition(text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.moovu_admission_transition(text, uuid, text)
  to service_role;
