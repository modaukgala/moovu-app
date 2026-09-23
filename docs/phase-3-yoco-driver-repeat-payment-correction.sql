-- Phase 3 forward correction: a successful payment remains immutable history,
-- but must not permanently prevent a Driver from paying newly accrued debt.
-- Apply after docs/phase-3-yoco-driver-online-payments.sql.

begin;

drop index if exists public.driver_online_payment_attempts_active_uidx;

create unique index driver_online_payment_attempts_active_uidx
  on public.driver_online_payment_attempts(driver_id, obligation_type)
  where state in ('CREATED', 'PENDING', 'RECONCILIATION_REQUIRED');

commit;
