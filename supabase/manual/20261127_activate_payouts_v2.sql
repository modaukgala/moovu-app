-- Run ONLY after the payouts-v2 app code is live on production (owner says "promote").
-- Turns on: tiered booking fee (3.63% rounded up, flat minimum kept), booking fee owed on cash trips,
-- card commission netted inside payouts, and driver payout requests. Takes effect from this moment.
update public.phase5_policies
   set service_fee_tier_bps = 363,
       payout_v2_from = now()
 where version = 'phase5-2026-09-owner-v1' and active
returning version, service_fee_tier_bps, payout_v2_from;

-- Undo (stops all of the above for new trips; nothing already recorded is lost):
-- update public.phase5_policies set service_fee_tier_bps = null, payout_v2_from = null where version = 'phase5-2026-09-owner-v1';
