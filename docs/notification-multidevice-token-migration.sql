-- MOOVU multi-device push token alignment
-- Review in Supabase SQL Editor before running. Safe/additive only.
-- Purpose:
-- 1. Preserve multiple active devices per customer/driver/admin.
-- 2. Track the current device independently with device_id.
-- 3. Keep old token uniqueness while adding a user/device/token uniqueness contract.

alter table public.fcm_tokens
  add column if not exists device_id text,
  add column if not exists app_version text,
  add column if not exists enabled boolean not null default true,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Keep legacy is_active and the new enabled flag aligned for existing rows.
update public.fcm_tokens
set enabled = coalesce(is_active, true)
where enabled is distinct from coalesce(is_active, true);

-- Each physical/logical device may keep its own token row for the same user.
-- The existing token unique constraint can remain; this adds lookup integrity for multi-device status checks.
create unique index if not exists fcm_tokens_user_device_token_unique
  on public.fcm_tokens(user_id, device_id, token)
  where device_id is not null;

create index if not exists fcm_tokens_user_role_device_active_idx
  on public.fcm_tokens(user_id, role, device_id)
  where is_active = true and enabled = true;

create index if not exists fcm_tokens_role_active_enabled_idx
  on public.fcm_tokens(role, app_type)
  where is_active = true and enabled = true;

comment on column public.fcm_tokens.device_id is
  'Stable client-generated device identifier. Do not use this as a secret.';

comment on column public.fcm_tokens.enabled is
  'Device-level notification opt-in flag. is_active remains the legacy delivery flag.';

comment on column public.fcm_tokens.app_version is
  'Optional app/web build version reported during token registration.';
