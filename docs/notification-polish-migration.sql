-- MOOVU notification polish migration
-- Review and run on staging before production.
-- This is additive. It stores notification delivery history for admin visibility.

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text null check (role is null or role in ('customer', 'driver', 'admin')),
  title text not null,
  body text not null,
  url text null,
  data jsonb not null default '{}'::jsonb,
  delivery_status text not null default 'queued'
    check (delivery_status in ('queued', 'sent', 'failed', 'no_tokens')),
  error_message text null,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_notifications
  add column if not exists role text,
  add column if not exists url text,
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists delivery_status text not null default 'queued',
  add column if not exists error_message text,
  add column if not exists read_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists app_notifications_user_created_idx
  on public.app_notifications(user_id, created_at desc);

create index if not exists app_notifications_role_created_idx
  on public.app_notifications(role, created_at desc);

create index if not exists app_notifications_delivery_status_idx
  on public.app_notifications(delivery_status, created_at desc);

create index if not exists app_notifications_failed_idx
  on public.app_notifications(created_at desc)
  where delivery_status in ('failed', 'no_tokens');

alter table public.app_notifications enable row level security;

drop policy if exists "Users can read own app notifications" on public.app_notifications;
create policy "Users can read own app notifications"
  on public.app_notifications
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can update own app notifications" on public.app_notifications;
create policy "Users can update own app notifications"
  on public.app_notifications
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Admin reads for this table should continue through server-side admin API routes
-- using the service role. Do not expose service role keys to the browser.
