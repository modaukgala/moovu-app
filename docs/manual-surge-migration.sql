-- MOOVU manual surge pricing migration
-- Review first, then run on staging before production.
-- This is additive and does not change existing trip fares.

begin;

create table if not exists public.app_pricing_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_pricing_settings enable row level security;

comment on table public.app_pricing_settings is
  'Platform pricing settings managed through server-side admin APIs. Do not write from the browser.';

comment on column public.app_pricing_settings.key is
  'Setting key, for example manual_surge.';

comment on column public.app_pricing_settings.value is
  'JSON value for the setting. manual_surge stores mode, label, multiplier, and customer message.';

insert into public.app_pricing_settings (key, value)
values (
  'manual_surge',
  '{"mode":"normal","label":"Normal","multiplier":1.0,"message":"Standard pricing"}'::jsonb
)
on conflict (key) do nothing;

-- Store the pricing context used for new bookings when the app code provides it.
-- Existing completed trips are not recalculated or changed.
alter table public.trips
  add column if not exists surge_label text null,
  add column if not exists surge_multiplier numeric(4,2) null,
  add column if not exists fare_breakdown jsonb null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trips_surge_label_check'
  ) then
    alter table public.trips
      add constraint trips_surge_label_check
      check (surge_label is null or surge_label in ('normal', 'busy', 'heavy_demand', 'rain_event'))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'trips_surge_multiplier_check'
  ) then
    alter table public.trips
      add constraint trips_surge_multiplier_check
      check (surge_multiplier is null or (surge_multiplier >= 1.0 and surge_multiplier <= 1.4))
      not valid;
  end if;
end $$;

create index if not exists trips_surge_label_idx
  on public.trips (surge_label)
  where surge_label is not null;

create index if not exists app_pricing_settings_updated_by_idx
  on public.app_pricing_settings(updated_by)
  where updated_by is not null;

drop policy if exists "Service role can manage app pricing settings" on public.app_pricing_settings;
create policy "Service role can manage app pricing settings"
  on public.app_pricing_settings
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

commit;
