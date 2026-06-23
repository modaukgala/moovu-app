-- MOOVU trip safety audio recordings
-- Review-only migration. Run in Supabase SQL Editor after staging review.
-- This creates a private storage bucket and metadata table for customer-triggered
-- safety recordings linked to a trip. It does not allow driver access by default.

create table if not exists public.trip_audio_recordings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  driver_id uuid null references public.drivers(id) on delete set null,
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  status text not null default 'active'
    check (status in ('active', 'deleted', 'flagged', 'case_linked')),
  safety_case_id uuid null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists trip_audio_recordings_trip_id_idx
  on public.trip_audio_recordings(trip_id);

create index if not exists trip_audio_recordings_customer_id_idx
  on public.trip_audio_recordings(customer_id);

create index if not exists trip_audio_recordings_driver_id_idx
  on public.trip_audio_recordings(driver_id);

create index if not exists trip_audio_recordings_case_id_idx
  on public.trip_audio_recordings(safety_case_id)
  where safety_case_id is not null;

create index if not exists trip_audio_recordings_created_at_idx
  on public.trip_audio_recordings(created_at desc);

alter table public.trip_audio_recordings enable row level security;

drop policy if exists "Customers can read their own trip audio recordings"
  on public.trip_audio_recordings;
create policy "Customers can read their own trip audio recordings"
  on public.trip_audio_recordings
  for select
  using (
    exists (
      select 1
      from public.customers c
      where c.id = trip_audio_recordings.customer_id
        and c.auth_user_id = auth.uid()
    )
  );

drop policy if exists "Customers can soft delete their own trip audio recordings"
  on public.trip_audio_recordings;
create policy "Customers can soft delete their own trip audio recordings"
  on public.trip_audio_recordings
  for update
  using (
    exists (
      select 1
      from public.customers c
      where c.id = trip_audio_recordings.customer_id
        and c.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.customers c
      where c.id = trip_audio_recordings.customer_id
        and c.auth_user_id = auth.uid()
    )
  );

-- Direct client inserts are intentionally not granted. The app uploads through
-- server-side API routes using the service role after verifying trip ownership
-- and allowed trip status.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-audio-recordings',
  'trip-audio-recordings',
  false,
  52428800,
  array[
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/aac',
    'audio/ogg'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage object access is also handled by server-generated signed URLs.
-- Admin/support review should use protected server APIs, and only expose
-- recordings when linked to a safety/support case.
