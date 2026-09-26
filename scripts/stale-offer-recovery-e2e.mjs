import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Disposable only. Never point this fixture runner at production.
const url = process.env.PHASE3_E2E_SUPABASE_URL;
assert.equal(new URL(url).hostname, 'tangtlmdpnvmoviwrgvd.supabase.co');
const db = createClient(url, process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const run = randomUUID();
const checks = [];
const drivers = [];
const trips = [];
function required(result) { assert.ifError(result.error); return result.data; }
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name); }
async function driver() {
  const id = randomUUID();
  required(await db.from('drivers').insert({ id, first_name: 'StaleOfferTest', last_name: run,
    phone: '+278' + String(Date.now()).slice(-8), status: 'approved', verification_status: 'approved',
    profile_completed: true, online: true, busy: false, seating_capacity: 7,
    lat: -25.48, lng: 28.68, last_seen: new Date().toISOString() }));
  drivers.push(id); return id;
}
async function trip(extra = {}) {
  const id = randomUUID();
  required(await db.from('trips').insert({ id, pickup_address: 'Disposable ' + run, dropoff_address: 'Test',
    pickup_lat: -25.48, pickup_lng: 28.68, dropoff_lat: -25.49, dropoff_lng: 28.70,
    status: 'requested', payment_method: 'cash', ride_option: 'go', fare_amount: 50, ...extra }));
  trips.push(id); return id;
}
const reserve = (t, d, cycle = 1) => db.rpc('reserve_trip_offer', {
  p_trip_id: t, p_driver_id: d, p_dispatch_cycle: cycle, p_sequence_number: 1,
  p_distance_km: 0, p_road_eta_seconds: 60, p_dispatch_score: 1, p_score_breakdown: {},
  p_escalation_seconds: 25, p_accept_window_seconds: 25,
});
const offers = async t => required(await db.from('driver_trip_offers').select('*').eq('trip_id', t));
const closeOffer = async t => required(await db.from('driver_trip_offers').update({ status: 'cancelled' }).eq('trip_id', t).in('status', ['shown', 'pending']));
try {
  const a = await driver(), b = await driver();
  const old = await trip(), fresh = await trip();
  required(await reserve(old, a));
  const rejected = await reserve(fresh, a);
  check('Genuinely live offer still blocks another reservation', Boolean(rejected.error));
  check('Rejected reservation leaves live offer intact', (await offers(old))[0].status === 'shown');
  required(await db.from('driver_trip_offers').update({ accept_deadline_at: new Date(Date.now() - 1000).toISOString() }).eq('trip_id', old));
  required(await reserve(fresh, a));
  check('Expired cross-trip reservation no longer violates unique index', (await offers(old))[0].status === 'expired' && (await offers(fresh))[0].status === 'shown');
  await closeOffer(fresh);

  for (const status of ['cancelled', 'completed']) {
    const stale = await trip(), next = await trip();
    required(await reserve(stale, a));
    // Fixture terminal state intentionally leaves its offer unresolved.
    required(await db.from('trips').update({ status }).eq('id', stale));
    required(await reserve(next, a));
    check(status + ' trip offer releases reservation without deleting history', (await offers(stale))[0].status === 'cancelled');
    await closeOffer(next);
  }

  const race = await trip();
  required(await reserve(race, a)); required(await reserve(race, b));
  const accepted = await Promise.all([a, b].map(d => db.rpc('accept_trip_offer', { p_trip_id: race, p_driver_id: d })));
  const winners = accepted.filter(r => !r.error && r.data?.[0]?.ok);
  check('Concurrent acceptance produces exactly one winner', winners.length === 1);
  const winner = winners[0].data[0].driver_id, loser = winner === a ? b : a;
  const raceOffers = await offers(race);
  check('Acceptance atomically closes losing offer', raceOffers.filter(o => o.status === 'accepted').length === 1 && raceOffers.filter(o => o.status === 'cancelled').length === 1);
  const next = await trip();
  check('Real active assignment remains blocked', Boolean((await reserve(next, winner)).error));
  required(await reserve(next, loser));
  check('Losing driver can immediately receive new trip', (await offers(next))[0].driver_id === loser);
  await closeOffer(next);

  // Stale terminal label with an unexpired deadline must not block candidate lookup.
  const staleWinner = await trip(), future = await trip();
  required(await reserve(staleWinner, loser));
  required(await db.from('trips').update({ status: 'assigned', driver_id: winner, offer_status: 'accepted' }).eq('id', staleWinner));
  const query = await db.from('driver_trip_offers').select('driver_id,trips!inner(status,driver_id)')
    .eq('driver_id', loser).in('status', ['pending', 'shown']).gt('accept_deadline_at', new Date().toISOString())
    .in('trips.status', ['requested', 'offered']).is('trips.driver_id', null);
  check('Candidate query excludes already-won trip despite future offer deadline', required(query).length === 0);
  required(await reserve(future, loser));
  check('Superseded reservation is cancelled before inserting next offer', (await offers(staleWinner))[0].status === 'cancelled');
  await closeOffer(future);

  const unpaid = await trip({ payment_method: 'online' });
  check('Unpaid online dispatch remains blocked', Boolean((await reserve(unpaid, loser)).error));
  check('Unpaid online dispatch creates no offers', (await offers(unpaid)).length === 0);
  const customer = required(await db.from('customers').select('id').limit(1).single());
  required(await db.from('trips').update({ customer_id: customer.id }).eq('id', unpaid));
  required(await db.from('online_payment_attempts').insert({ customer_id: customer.id, trip_id: unpaid,
    provider: 'YOCO', amount_cents: 5000, currency: 'ZAR', fare_version: 'a'.repeat(64),
    locked_fare_snapshot: { disposable: true }, state: 'SUCCEEDED', verified_at: new Date().toISOString(),
    idempotency_key: 'stale-offer:' + run, payload_hash: 'b'.repeat(64) }));
  required(await reserve(unpaid, loser));
  check('Verified online payment permits dispatch with same reservation function', (await offers(unpaid)).length === 1);
  const transactions = required(await db.from('financial_transactions').select('id').in('source_id', trips));
  check('Offer operations generate no financial postings', transactions.length === 0);
  console.log(JSON.stringify({ run, passed: checks.length, checks }));
} finally {
  // Keep disposable trip/offer evidence; retire only this runner's test drivers.
  if (drivers.length) required(await db.from('drivers').update({ online: false }).in('id', drivers));
}
