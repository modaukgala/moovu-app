-- Disposable-only application E2E baseline alignment. Never production.
-- Add only fields already present in production and read by existing routes.
begin;
alter table public.customers add column if not exists first_name text;
alter table public.customers add column if not exists last_name text;
alter table public.customers add column if not exists phone text;
alter table public.customers add column if not exists normalized_phone text;
alter table public.customers add column if not exists status text not null default 'active';

alter table public.trips add column if not exists pickup_address text;
alter table public.trips add column if not exists dropoff_address text;
alter table public.trips add column if not exists dropoff_lat numeric;
alter table public.trips add column if not exists dropoff_lng numeric;
alter table public.trips add column if not exists distance_km numeric;
alter table public.trips add column if not exists final_add_stop_increase numeric;
alter table public.trips add column if not exists stop_waiting_fee numeric;
alter table public.trips add column if not exists route_distance_km numeric;
alter table public.trips add column if not exists route_duration_min numeric;
alter table public.trips add column if not exists actual_distance_km numeric;
alter table public.trips add column if not exists actual_duration_min numeric;
alter table public.trips add column if not exists otp_verified boolean default false;

alter table public.driver_trip_offers add column if not exists visible_until timestamptz;
alter table public.driver_trip_offers add column if not exists escalates_at timestamptz;
alter table public.driver_trip_offers add column if not exists accept_deadline_at timestamptz;
alter table public.driver_trip_offers add column if not exists distance_km numeric(10,3);
alter table public.driver_trip_offers add column if not exists dispatch_score numeric(12,3);
alter table public.driver_trip_offers add column if not exists created_at timestamptz default now();

alter table public.driver_offer_stats add column if not exists offers_accepted integer default 0;
alter table public.driver_offer_stats add column if not exists offers_rejected integer default 0;
alter table public.driver_offer_stats add column if not exists offers_missed integer default 0;
commit;
