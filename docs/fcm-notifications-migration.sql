-- MOOVU Firebase Cloud Messaging token storage migration
-- Review before running. This table stores public FCM registration tokens only, not service account secrets.

create table if not exists public.fcm_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('customer', 'driver', 'admin')),
  token text not null unique,
  platform text null,
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
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fcm_tokens
  add column if not exists platform text,
  add column if not exists app_type text,
  add column if not exists user_agent text,
  add column if not exists device_label text,
  add column if not exists is_active boolean not null default true,
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

create index if not exists fcm_tokens_active_role_idx
  on public.fcm_tokens(role)
  where is_active = true;

create index if not exists fcm_tokens_app_type_idx
  on public.fcm_tokens(app_type)
  where is_active = true;

alter table public.fcm_tokens enable row level security;

drop policy if exists "Users can read own fcm tokens" on public.fcm_tokens;
create policy "Users can read own fcm tokens"
  on public.fcm_tokens
  for select
  using (auth.uid() = user_id);

-- Writes should continue through the server API because the app verifies role ownership server-side.
-- Service role bypasses RLS for server-side registration, cleanup, and sends.
