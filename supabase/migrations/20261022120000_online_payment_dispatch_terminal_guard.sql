-- Cross-version guard for the existing online-payment dispatch attempt state.
-- Execute as one migration transaction. Do not backfill or rewrite attempt rows.
do $$
declare v_registered boolean;
begin
  if to_regclass('public.online_payment_attempts') is null then
    raise exception 'Online payment attempts contract is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='online_payment_attempts'
      and column_name='dispatch_state' and data_type='text'
  ) then
    raise exception 'Online payment dispatch state contract is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.online_payment_attempts'::regclass
      and tgname='phase3_online_attempt_immutability' and not tgisinternal
  ) then
    raise exception 'Online payment immutability contract is missing';
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select exists(select 1 from supabase_migrations.schema_migrations where version=$1)'
      into v_registered using '20261022120000';
    if v_registered then raise exception 'Dispatch terminal guard migration is already recorded'; end if;
  end if;
  if exists (
    select 1 from pg_trigger
    where tgrelid='public.online_payment_attempts'::regclass
      and tgname='online_payment_dispatch_terminal_guard' and not tgisinternal
  ) then
    raise exception 'Dispatch terminal guard trigger already exists';
  end if;
end $$;

create function public.reject_online_payment_dispatch_regression()
returns trigger language plpgsql
set search_path=pg_catalog,public
as $$
begin
  if old.dispatch_state='DISPATCHED' and new.dispatch_state is distinct from 'DISPATCHED' then
    raise exception 'A dispatched online payment attempt cannot return to recovery'
      using errcode='23514';
  end if;
  return new;
end $$;

revoke all on function public.reject_online_payment_dispatch_regression()
  from public,anon,authenticated;

create trigger online_payment_dispatch_terminal_guard
before update of dispatch_state on public.online_payment_attempts
for each row execute function public.reject_online_payment_dispatch_regression();

-- Verification after application (read-only):
-- select tgname from pg_trigger where tgrelid='public.online_payment_attempts'::regclass
--   and tgname='online_payment_dispatch_terminal_guard' and not tgisinternal;
-- The migration runner must record version 20261022120000 only after this succeeds.
