-- MOOVU Firebase Cloud Messaging token storage migration
-- Review before running. This table stores public FCM registration tokens only, not service account secrets.

create table if not exists public.fcm_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('customer', 'driver', 'admin')),
  token text not null unique,
  platform text not null default 'unknown',
  device_id text null,
  app_source text null,
  app_type text null check (
    app_type is null or app_type in (
      'web_customer',
      'web_driver',
      'web_admin',
      'android_customer',
      'android_driver'
    )
  ),
  user_agent text null,
  device_label text null,
  is_active boolean not null default true,
  last_used_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fcm_tokens
  add column if not exists platform text not null default 'unknown',
  add column if not exists device_id text,
  add column if not exists app_source text,
  add column if not exists app_type text,
  add column if not exists user_agent text,
  add column if not exists device_label text,
  add column if not exists is_active boolean not null default true,
  add column if not exists last_used_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fcm_tokens_app_type_check'
  ) then
    alter table public.fcm_tokens
      add constraint fcm_tokens_app_type_check
      check (
        app_type is null or app_type in (
          'web_customer',
          'web_driver',
          'web_admin',
          'android_customer',
          'android_driver'
        )
      );
  end if;
end $$;

create index if not exists fcm_tokens_user_role_idx
  on public.fcm_tokens(user_id, role);

create index if not exists fcm_tokens_user_id_idx
  on public.fcm_tokens(user_id);

create index if not exists fcm_tokens_role_idx
  on public.fcm_tokens(role);

create index if not exists fcm_tokens_active_role_idx
  on public.fcm_tokens(role)
  where is_active = true;

create index if not exists fcm_tokens_active_idx
  on public.fcm_tokens(is_active);

create index if not exists fcm_tokens_app_type_idx
  on public.fcm_tokens(app_type)
  where is_active = true;

create index if not exists fcm_tokens_app_source_idx
  on public.fcm_tokens(app_source)
  where is_active = true;

alter table public.fcm_tokens enable row level security;

drop policy if exists "Users can read own fcm tokens" on public.fcm_tokens;
create policy "Users can read own fcm tokens"
  on public.fcm_tokens
  for select
  using (auth.uid() = user_id);

-- Writes should continue through the server API because the app verifies role ownership server-side.
-- Service role bypasses RLS for server-side registration, cleanup, and sends.

drop policy if exists "Users can delete own fcm tokens" on public.fcm_tokens;
create policy "Users can delete own fcm tokens"
  on public.fcm_tokens
  for delete
  using (auth.uid() = user_id);

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

create index if not exists app_notifications_user_created_idx
  on public.app_notifications(user_id, created_at desc);

create index if not exists app_notifications_user_unread_idx
  on public.app_notifications(user_id)
  where read_at is null;

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
