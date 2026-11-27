-- Switch payouts v2 on (run after the app code is live). Takes effect from this moment.
update public.moovu_finance_settings set service_fee_tier_bps = 363, payout_v2_from = now(), updated_at = now() where id;
-- Switch off: update public.moovu_finance_settings set service_fee_tier_bps = null, payout_v2_from = null, updated_at = now() where id;
