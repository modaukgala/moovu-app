import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.PHASE3_E2E_SUPABASE_URL;
assert.equal(new URL(url).hostname, 'tangtlmdpnvmoviwrgvd.supabase.co');
const db = createClient(url, process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const run = randomUUID();
const ok = r => { assert.ifError(r.error); return r.data; };
const policy = ok(await db.rpc('phase2_current_policy'));
assert.equal(policy.mode, 'AUTHORITATIVE');
assert.equal(Number(policy.go_basis_points), 1500);
assert.equal(Number(policy.go_xl_basis_points), 1500);
const clearing = ok(await db.rpc('phase1_ensure_financial_account', {
  p_account_code: 'PLATFORM:COMMISSION_REVENUE:ZAR', p_account_category: 'COMMISSION_REVENUE',
  p_owner_type: 'PLATFORM', p_owner_id: null, p_normal_balance_side: 'CREDIT', p_currency: 'ZAR',
}));
const admins = ok(await db.from('profiles').select('id').in('role', ['owner', 'admin']).limit(1));
assert.ok(admins[0], 'Disposable admin fixture is required');
for (const amount of [0, 8580, 10000, 15000, 50000]) {
  const driver = randomUUID(), trip = randomUUID();
  ok(await db.from('drivers').insert({ id: driver, first_name: 'DebtPolicyTest', last_name: run,
    phone: '+278' + String(Date.now()).slice(-8), status: 'approved', verification_status: 'approved',
    profile_completed: true, online: true, busy: false, seating_capacity: 7,
    lat: -25.48, lng: 28.68, last_seen: new Date().toISOString() }));
  ok(await db.from('trips').insert({ id: trip, pickup_address: `Debt policy ${run}`, dropoff_address: 'Test',
    pickup_lat: -25.48, pickup_lng: 28.68, dropoff_lat: -25.49, dropoff_lng: 28.70,
    status: 'requested', payment_method: 'cash', ride_option: 'go', fare_amount: 100 }));
  if (amount) {
    const debt = ok(await db.rpc('phase1_ensure_financial_account', {
      p_account_code: `DRIVER:${driver}:COMMISSION_DEBT:ZAR`, p_account_category: 'DRIVER_COMMISSION_DEBT',
      p_owner_type: 'DRIVER', p_owner_id: driver, p_normal_balance_side: 'DEBIT', p_currency: 'ZAR',
    }));
    ok(await db.rpc('phase1_post_financial_transaction', {
      p_idempotency_key: `debt-policy-test:${driver}`, p_payload_hash: 'a'.repeat(64),
      p_transaction_type: 'DRIVER_COMMISSION', p_source_type: 'TRIP', p_source_id: trip,
      p_currency: 'ZAR', p_actor_type: 'SYSTEM', p_actor_id: null, p_effective_at: new Date().toISOString(),
      p_entries: [{ account_id: debt.id, entry_side: 'DEBIT', amount_cents: amount },
        { account_id: clearing.id, entry_side: 'CREDIT', amount_cents: amount }],
      p_metadata: { disposable: true }, p_reversal_of_transaction_id: null,
    }));
  }
  const before = ok(await db.rpc('phase2_finance_eligibility', { p_driver_id: driver }));
  assert.equal(Number(before.net_owed_cents), amount);
  assert.equal(before.authoritative_eligible, true);
  assert.equal(before.commission_lock_enforced, false);
  ok(await db.rpc('reserve_trip_offer', { p_trip_id: trip, p_driver_id: driver,
    p_dispatch_cycle: 1, p_sequence_number: 1, p_distance_km: 0, p_road_eta_seconds: 60,
    p_dispatch_score: 1, p_score_breakdown: {}, p_escalation_seconds: 25, p_accept_window_seconds: 25 }));
  const accepted = ok(await db.rpc('accept_trip_offer', { p_trip_id: trip, p_driver_id: driver }));
  assert.equal(accepted[0].ok, true);
  const after = ok(await db.rpc('phase2_finance_eligibility', { p_driver_id: driver }));
  assert.equal(Number(after.net_owed_cents), amount, 'Offers cannot erase debt');
  // Retire the accepted disposable fixture before testing independent manual assignment.
  ok(await db.from('trips').update({ status: 'cancelled' }).eq('id', trip));
  ok(await db.from('drivers').update({ busy: false, subscription_status: 'active',
    subscription_expires_at: new Date(Date.now() + 86400000).toISOString() }).eq('id', driver));
  const manualTrip = randomUUID();
  ok(await db.from('trips').insert({ id: manualTrip, pickup_address: `Manual debt policy ${run}`,
    dropoff_address: 'Test', status: 'requested', payment_method: 'cash', ride_option: 'go', fare_amount: 100 }));
  ok(await db.from('drivers').update({ status: 'inactive' }).eq('id', driver));
  const blocked = await db.rpc('phase05b_assign_driver', {
    p_trip_id: manualTrip, p_driver_id: driver, p_actor_id: admins[0].id,
  });
  assert.ok(blocked.error, 'Inactive driver must remain blocked');
  ok(await db.from('drivers').update({ status: 'approved', subscription_status: 'inactive' }).eq('id', driver));
  const expired = await db.rpc('phase05b_assign_driver', {
    p_trip_id: manualTrip, p_driver_id: driver, p_actor_id: admins[0].id,
  });
  assert.ok(expired.error, 'Manual assignment subscription requirement must remain intact');
  ok(await db.from('drivers').update({ subscription_status: 'active' }).eq('id', driver));
  ok(await db.rpc('phase05b_assign_driver', {
    p_trip_id: manualTrip, p_driver_id: driver, p_actor_id: admins[0].id,
  }));
  assert.equal(Number(ok(await db.rpc('phase2_finance_eligibility', { p_driver_id: driver })).net_owed_cents), amount);
  ok(await db.from('drivers').update({ online: false }).eq('id', driver));
  console.log(`PASS: R${amount / 100} debt preserved; offers, acceptance, manual assignment allowed; inactive/subscription blockers preserved`);
}
