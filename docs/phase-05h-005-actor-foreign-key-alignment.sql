-- MOOVU Phase 0.5H - actor foreign-key alignment
-- REVIEWED MIGRATION - DO NOT RUN AUTOMATICALLY.
--
-- Problem:
-- Driver and Customer actions use Supabase Auth user IDs as actor IDs. The
-- existing audit columns below reference public.profiles(id), but most Driver
-- and Customer Auth users do not have public.profiles rows. Atomic trip RPCs
-- therefore roll back when their trip/audit or wallet/audit insert is reached.
--
-- This migration aligns those actor columns with the canonical Auth identity
-- domain already used by public.moovu_business_events.actor_id. Existing rows
-- are validated before either constraint is replaced.

begin;

do $$
begin
  if exists (
    select 1
    from public.trip_events event
    where event.created_by is not null
      and not exists (select 1 from auth.users actor where actor.id = event.created_by)
  ) then
    raise exception 'trip_events contains created_by values that are not Supabase Auth users';
  end if;

  if exists (
    select 1
    from public.driver_wallet_transactions transaction_row
    where transaction_row.created_by is not null
      and not exists (select 1 from auth.users actor where actor.id = transaction_row.created_by)
  ) then
    raise exception 'driver_wallet_transactions contains created_by values that are not Supabase Auth users';
  end if;
end;
$$;

alter table public.trip_events
  drop constraint if exists trip_events_created_by_fkey;

alter table public.trip_events
  add constraint trip_events_created_by_fkey
  foreign key (created_by)
  references auth.users(id)
  on delete set null
  not valid;

alter table public.trip_events
  validate constraint trip_events_created_by_fkey;

alter table public.driver_wallet_transactions
  drop constraint if exists driver_wallet_transactions_created_by_fkey;

alter table public.driver_wallet_transactions
  add constraint driver_wallet_transactions_created_by_fkey
  foreign key (created_by)
  references auth.users(id)
  on delete set null
  not valid;

alter table public.driver_wallet_transactions
  validate constraint driver_wallet_transactions_created_by_fkey;

commit;

-- Post-application verification (read only):
--
-- select c.conname, c.conrelid::regclass::text as table_name,
--        pg_get_constraintdef(c.oid) as definition
-- from pg_constraint c
-- where c.conname in (
--   'trip_events_created_by_fkey',
--   'driver_wallet_transactions_created_by_fkey'
-- )
-- order by c.conname;
