-- DISPOSABLE ONLY: tangtlmdpnvmoviwrgvd. NEVER production.
-- Restore the existing Phase 0/1 baseline by removing only unused Phase 2 objects.
-- Verify project identity in the SQL Editor before executing. No CASCADE.
begin;
do $$ begin
  if (select mode from public.phase2_finance_policy where policy_key='phase2-driver-finance') is distinct from 'OFF'
    or exists(select 1 from public.phase2_shadow_reconciliations)
    or exists(select 1 from public.phase2_historical_finance_exceptions)
    or exists(select 1 from public.trips where commission_policy_id is not null or commission_basis_points is not null
      or commission_locked_at is not null or commission_rounding_version is not null)
    or exists(select 1 from public.financial_transactions where idempotency_key like 'driver_payment:%' or idempotency_key like 'trip_commission:%')
  then raise exception 'Phase 2 is not unused and OFF; reset refused'; end if;
end $$;
drop trigger phase2_snapshot_new_trip_trigger on public.trips;
drop trigger phase2_guard_trip_commission_snapshot_trigger on public.trips;
drop function public.phase2_post_verified_driver_payment(uuid,uuid);
drop function public.phase2_post_trip_commission(uuid,uuid);
drop function public.phase2_finance_eligibility(uuid);
drop function public.phase2_driver_finance_position(uuid);
drop function public.phase2_guard_trip_commission_snapshot();
drop function public.phase2_snapshot_new_trip();
drop function public.phase2_lock_trip_commission_snapshot(uuid);
drop function public.phase2_current_policy();
drop function public.phase2_contract_version();
drop table public.phase2_shadow_reconciliations;
drop table public.phase2_historical_finance_exceptions;
drop table public.phase2_finance_policy;
alter table public.trips drop column commission_policy_id, drop column commission_basis_points,
  drop column commission_rounding_version, drop column commission_locked_at;
commit;
