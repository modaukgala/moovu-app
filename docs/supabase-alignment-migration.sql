-- MOOVU Supabase alignment migration
-- Applied non-destructively to project mvazbszenqahgqpznhhq on 2026-05-06.
--
-- Purpose:
-- - Align current app code with the live Supabase schema.
-- - Fix admin receipts querying trips.completed_at.
-- - Enable trip chat storage.
-- - Add legal acceptance mirror columns.
-- - Add ride option reporting support.
-- - Add dispatch offer stats RPC.
-- - Create the driver-docs storage bucket expected by the app.

alter table public.trips
  add column if not exists completed_at timestamptz,
  add column if not exists ride_option text;

update public.trips t
set completed_at = coalesce(
  (
    select max(te.created_at)
    from public.trip_events te
    where te.trip_id = t.id
      and te.event_type in ('trip_completed', 'completed')
  ),
  t.created_at
)
where t.completed_at is null
  and t.status = 'completed';

create index if not exists trips_completed_at_idx
  on public.trips (completed_at);

create index if not exists trips_ride_option_idx
  on public.trips (ride_option);

create or replace function public.set_trip_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists set_trip_completed_at_trigger on public.trips;
create trigger set_trip_completed_at_trigger
before update on public.trips
for each row
execute function public.set_trip_completed_at();

alter table public.customers
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists privacy_accepted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists privacy_version text,
  add column if not exists legal_acceptance_source text;

create index if not exists customers_terms_version_idx
  on public.customers (terms_version);

create index if not exists customers_privacy_version_idx
  on public.customers (privacy_version);

create table if not exists public.trip_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_role text not null check (sender_role in ('customer', 'driver')),
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz null
);

create index if not exists trip_messages_trip_created_idx
  on public.trip_messages (trip_id, created_at);

create index if not exists trip_messages_sender_created_idx
  on public.trip_messages (sender_user_id, created_at);

alter table public.trip_messages enable row level security;

drop policy if exists "Trip chat participants can read messages"
  on public.trip_messages;

create policy "Trip chat participants can read messages"
  on public.trip_messages
  for select
  using (
    exists (
      select 1
      from public.trips t
      left join public.customers c on c.id = t.customer_id
      left join public.driver_accounts da on da.driver_id = t.driver_id
      where t.id = trip_messages.trip_id
        and t.driver_id is not null
        and t.status in ('assigned', 'arrived', 'ongoing', 'completed', 'cancelled')
        and (
          t.customer_auth_user_id = auth.uid()
          or c.auth_user_id = auth.uid()
          or da.user_id = auth.uid()
        )
    )
  );

drop policy if exists "Trip chat participants can insert messages"
  on public.trip_messages;

create policy "Trip chat participants can insert messages"
  on public.trip_messages
  for insert
  with check (
    sender_user_id = auth.uid()
    and exists (
      select 1
      from public.trips t
      left join public.customers c on c.id = t.customer_id
      left join public.driver_accounts da on da.driver_id = t.driver_id
      where t.id = trip_messages.trip_id
        and t.driver_id is not null
        and t.status in ('assigned', 'arrived', 'ongoing')
        and (
          (
            trip_messages.sender_role = 'customer'
            and (
              t.customer_auth_user_id = auth.uid()
              or c.auth_user_id = auth.uid()
            )
          )
          or (
            trip_messages.sender_role = 'driver'
            and da.user_id = auth.uid()
          )
        )
    )
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'trip_messages'
     ) then
    alter publication supabase_realtime add table public.trip_messages;
  end if;
end;
$$;

create or replace function public.increment_driver_offer_received(p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.driver_offer_stats (
    driver_id,
    offers_received,
    offers_accepted,
    offers_rejected,
    offers_missed,
    last_offer_at,
    updated_at
  )
  values (p_driver_id, 1, 0, 0, 0, now(), now())
  on conflict (driver_id)
  do update set
    offers_received = coalesce(public.driver_offer_stats.offers_received, 0) + 1,
    last_offer_at = now(),
    updated_at = now();
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-docs', 'driver-docs', false, null, null)
on conflict (id) do nothing;
