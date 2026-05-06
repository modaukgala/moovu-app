-- MOOVU trip chat migration
-- Review before running. Run only on local/staging first, then production after approval.
-- This migration is non-destructive and adds the trip_messages table plus RLS policies.

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

-- Optional Realtime setup:
-- Supabase Realtime must be enabled for public.trip_messages in the dashboard
-- or through a reviewed publication change. The app falls back to polling if
-- Realtime is not enabled.
