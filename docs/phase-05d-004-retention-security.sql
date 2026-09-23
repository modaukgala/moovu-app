-- REVIEW ONLY / NOT APPLIED / DO NOT EXECUTE WITHOUT SEPARATE APPROVAL.
-- Preserve financial and audit history by preventing destructive parent deletes.
begin;

-- Trip state, fare and audit mutations must use the trusted server/RPC path.
-- Existing customer/driver/staff SELECT policies remain unchanged.
revoke insert,update,delete,truncate on public.trips from anon,authenticated;
revoke insert,update,delete,truncate on public.trip_events from anon,authenticated;

alter table public.driver_wallets drop constraint driver_wallets_driver_id_fkey,
  add constraint driver_wallets_driver_id_fkey foreign key(driver_id) references public.drivers(id) on delete restrict;
alter table public.driver_wallet_transactions drop constraint driver_wallet_transactions_driver_id_fkey,
  add constraint driver_wallet_transactions_driver_id_fkey foreign key(driver_id) references public.drivers(id) on delete restrict;
alter table public.driver_wallet_transactions drop constraint driver_wallet_transactions_wallet_id_fkey,
  add constraint driver_wallet_transactions_wallet_id_fkey foreign key(wallet_id) references public.driver_wallets(id) on delete restrict;
alter table public.driver_settlements drop constraint driver_settlements_driver_id_fkey,
  add constraint driver_settlements_driver_id_fkey foreign key(driver_id) references public.drivers(id) on delete restrict;
alter table public.driver_subscription_payments drop constraint driver_subscription_payments_driver_id_fkey,
  add constraint driver_subscription_payments_driver_id_fkey foreign key(driver_id) references public.drivers(id) on delete restrict;
alter table public.trip_cancellation_fees drop constraint trip_cancellation_fees_trip_id_fkey,
  add constraint trip_cancellation_fees_trip_id_fkey foreign key(trip_id) references public.trips(id) on delete restrict;
alter table public.trip_events drop constraint trip_events_trip_id_fkey,
  add constraint trip_events_trip_id_fkey foreign key(trip_id) references public.trips(id) on delete restrict;

commit;
