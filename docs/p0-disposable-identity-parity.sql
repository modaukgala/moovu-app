-- DISPOSABLE ONLY. Never run on production. Preserves all existing foreign keys.
begin;
do $guard$
begin
  if current_setting('app.p0_disposable_project',true) is distinct from 'tangtlmdpnvmoviwrgvd' then
    raise exception 'Explicit disposable project setting required';
  end if;
end $guard$;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles alter column role set default 'admin';
do $guard$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_role_check') then
    alter table public.profiles add constraint profiles_role_check
      check(role in ('owner','admin','dispatcher','support','driver')) not valid;
  end if;
end $guard$;
alter table public.customers add column if not exists created_at timestamptz not null default now();
alter table public.customers add column if not exists updated_at timestamptz not null default now();
alter table public.customers add column if not exists email text;
alter table public.customers add column if not exists terms_accepted_at timestamptz;
alter table public.customers add column if not exists privacy_accepted_at timestamptz;
alter table public.customers add column if not exists terms_version text;
alter table public.customers add column if not exists privacy_version text;
alter table public.customers add column if not exists legal_acceptance_source text;
alter table public.customers add column if not exists referred_by_code text;
-- Old disposable fixtures contain repeated/invalid phone stand-ins; keep phone data,
-- but give missing normalized values unique, explicitly non-real fixture identifiers.
update public.customers set first_name=coalesce(first_name,'Disposable legacy'),last_name=coalesce(last_name,'Fixture'),
  phone=coalesce(phone,'disposable:'||id),normalized_phone=coalesce(normalized_phone,'disposable:'||id)
where first_name is null or last_name is null or phone is null or normalized_phone is null;
alter table public.customers alter column first_name set not null;
alter table public.customers alter column last_name set not null;
alter table public.customers alter column phone set not null;
alter table public.customers alter column normalized_phone set not null;
create unique index if not exists p0_disposable_customer_auth_unique on public.customers(auth_user_id);
create unique index if not exists p0_disposable_customer_phone_unique on public.customers(normalized_phone);
do $guard$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.customers'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%active%blocked%') then
    alter table public.customers add constraint p0_disposable_customer_status check(status in ('active','blocked'));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.trips'::regclass and conname='trips_created_by_fkey') then
    -- Mirrors the existing production actor FK on NEW rows. No FK is retargeted;
    -- NOT VALID avoids deleting or changing historical disposable orphan fixtures.
    alter table public.trips add constraint trips_created_by_fkey foreign key(created_by) references public.profiles(id) not valid;
  end if;
end $guard$;
commit;
