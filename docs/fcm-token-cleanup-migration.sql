-- MOOVU FCM token cleanup migration (REVIEW ONLY)
-- Purpose:
--   1. Keep Firebase FCM registration tokens as the production delivery token.
--   2. Deactivate legacy 64-character APNs device tokens that were previously saved in fcm_tokens.
--   3. Preserve token history for audit/debugging. This does not delete rows.
--
-- Run on staging first. Do not run on production until current iOS apps have been
-- rebuilt/reinstalled and confirmed to save FCM tokens longer than 100 characters.

alter table public.fcm_tokens
  add column if not exists enabled boolean not null default true,
  add column if not exists app_type text,
  add column if not exists platform text not null default 'unknown',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now();

-- Deactivate APNs-shaped iOS tokens. Firebase Admin cannot send to these as FCM
-- registration tokens, and they should not be used as the normal production path.
update public.fcm_tokens
set
  is_active = false,
  enabled = false,
  updated_at = now()
where
  coalesce(platform, '') = 'ios'
  and token ~* '^[a-f0-9]{64}$'
  and (coalesce(is_active, true) = true or coalesce(enabled, true) = true);

update public.fcm_tokens
set
  is_active = false,
  enabled = false,
  updated_at = now()
where
  coalesce(app_type, '') in ('ios_customer', 'ios_driver', 'ios_admin')
  and token ~* '^[a-f0-9]{64}$'
  and (coalesce(is_active, true) = true or coalesce(enabled, true) = true);

create index if not exists fcm_tokens_ios_active_type_idx
  on public.fcm_tokens(app_type, last_seen_at desc)
  where is_active = true and enabled = true and app_type in ('ios_customer', 'ios_driver', 'ios_admin');

create index if not exists fcm_tokens_active_token_shape_idx
  on public.fcm_tokens(platform, app_type)
  where is_active = true and enabled = true;

comment on table public.fcm_tokens is
  'Stores Firebase Cloud Messaging registration tokens. iOS APNs device tokens must not be stored as the active production token.';
