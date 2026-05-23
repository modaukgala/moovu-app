-- Native Android notification action tokens.
-- Required for replying to chat messages and accepting/declining trip offers from
-- the Android notification shade without exposing a user's browser session token.

create table if not exists public.notification_action_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('customer', 'driver', 'admin')),
  action_type text not null check (action_type in ('trip_offer', 'chat_reply')),
  trip_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_action_tokens_token_idx
  on public.notification_action_tokens(token);

create index if not exists notification_action_tokens_user_idx
  on public.notification_action_tokens(user_id);

create index if not exists notification_action_tokens_trip_idx
  on public.notification_action_tokens(trip_id);

create index if not exists notification_action_tokens_active_idx
  on public.notification_action_tokens(expires_at)
  where used_at is null;

alter table public.notification_action_tokens enable row level security;

drop policy if exists "Service role can manage notification action tokens" on public.notification_action_tokens;
create policy "Service role can manage notification action tokens"
  on public.notification_action_tokens
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Users can read own notification action tokens" on public.notification_action_tokens;
create policy "Users can read own notification action tokens"
  on public.notification_action_tokens
  for select
  using (auth.uid() = user_id);
