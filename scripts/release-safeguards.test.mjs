import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { classifyCheckout } from './yoco-unresolved-review.mjs';
import { loadReviewedMigrations, migrationTransaction } from './dispatch-maintenance-migrate.mjs';

test('four-file runner loads only pinned files and binds history inside each transaction', () => {
  const plan = loadReviewedMigrations();
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map(x => x.version), ['20261010185641','20261010190029','20261011103000','20261012191510']);
  for (const file of plan) {
    const sql = migrationTransaction(file);
    assert.match(sql, /^BEGIN;/);
    assert.match(sql, /SET LOCAL lock_timeout = '5s'/);
    assert.match(sql, /SET LOCAL statement_timeout = '120s'/);
    assert.match(sql, /INSERT INTO supabase_migrations\.schema_migrations/);
    assert.match(sql, /COMMIT;\n$/);
  }
  const output = JSON.parse(execFileSync(process.execPath,
    ['scripts/dispatch-maintenance-migrate.mjs', '--dry-run'], { encoding: 'utf8' }));
  assert.equal(output.productionConnected, false);
  assert.equal(output.files.length, 4);
});

test('missing webhook cannot authorize a payment; provider evidence must match locked binding', () => {
  const attempt = { id: 'attempt-1', trip_id: 'trip-1', provider_checkout_id: 'ch_one', amount_cents: 5500, currency: 'ZAR' };
  const completed = { id: 'ch_one', amount: 5500, currency: 'ZAR', processingMode: 'live',
    metadata: { paymentAttemptId: 'attempt-1', tripId: 'trip-1' }, status: 'completed', paymentId: 'p_one' };
  assert.equal(classifyCheckout(attempt, null, 'customer'), 'PROVIDER_MISMATCH_REVIEW');
  assert.equal(classifyCheckout(attempt, completed, 'customer'), 'PROVIDER_COMPLETED_NOT_SETTLED');
  assert.equal(classifyCheckout(attempt, { ...completed, amount: 5501 }, 'customer'), 'PROVIDER_MISMATCH_REVIEW');
  assert.equal(classifyCheckout(attempt, { ...completed, processingMode: 'test' }, 'customer'), 'PROVIDER_MISMATCH_REVIEW');
  assert.equal(classifyCheckout(attempt, { ...completed, status: 'processing' }, 'customer'), 'PROVIDER_NOT_FINAL');
  assert.equal(classifyCheckout(attempt, { ...completed, status: 'unknown' }, 'customer'), 'PROVIDER_UNCERTAIN_REVIEW');
  assert.equal(classifyCheckout(attempt, completed, 'customer'), 'PROVIDER_COMPLETED_NOT_SETTLED');
});
