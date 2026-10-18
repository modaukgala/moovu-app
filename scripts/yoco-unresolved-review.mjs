import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';

export function classifyCheckout(attempt, checkout, domain) {
  if (!checkout || checkout.id !== attempt.provider_checkout_id ||
      checkout.amount !== Number(attempt.amount_cents) || checkout.currency !== attempt.currency ||
      checkout.metadata?.paymentAttemptId !== attempt.id ||
      checkout.processingMode !== 'live') return 'PROVIDER_MISMATCH_REVIEW';
  if (domain === 'driver' && (checkout.metadata?.paymentDomain !== 'DRIVER_COMMISSION' ||
      checkout.metadata?.driverId !== attempt.driver_id)) return 'PROVIDER_MISMATCH_REVIEW';
  if (domain === 'customer' && checkout.metadata?.tripId !== attempt.trip_id)
    return 'PROVIDER_MISMATCH_REVIEW';
  if (checkout.status === 'completed' && typeof checkout.paymentId === 'string' && checkout.paymentId.length > 2)
    return 'PROVIDER_COMPLETED_NOT_SETTLED';
  if (['created', 'started', 'processing'].includes(checkout.status)) return 'PROVIDER_NOT_FINAL';
  return 'PROVIDER_UNCERTAIN_REVIEW';
}

async function main() {
  if (process.argv.length > 3 || !['--inventory', '--verify'].includes(process.argv[2] ?? '--inventory'))
    throw new Error('INVALID_READ_ONLY_MODE');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || new URL(url).hostname !== 'mvazbszenqahgqpznhhq.supabase.co')
    throw new Error('PRODUCTION_PROJECT_REF_REQUIRED');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('PRIVATE_SERVICE_ROLE_KEY_REQUIRED');
  const verify = process.argv[2] === '--verify';
  const yocoKey = process.env.YOCO_SECRET_KEY;
  if (verify && (process.env.YOCO_ENVIRONMENT !== 'live' || !yocoKey?.startsWith('sk_live_') ||
      (process.env.YOCO_API_BASE_URL ?? 'https://payments.yoco.com/api') !== 'https://payments.yoco.com/api'))
    throw new Error('TRUSTED_YOCO_LOOKUP_UNAVAILABLE');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const results = [];
  for (const [domain, table, fields] of [
    ['customer', 'online_payment_attempts', 'id,trip_id,provider_checkout_id,amount_cents,currency,state,created_at'],
    ['driver', 'driver_online_payment_attempts', 'id,driver_id,provider_checkout_id,amount_cents,currency,state,created_at'],
  ]) {
    const { data, error } = await db.from(table).select(fields).eq('provider', 'YOCO')
      .in('state', ['CREATED', 'PENDING']).order('created_at', { ascending: true }).limit(1000);
    if (error || !data) throw new Error('UNRESOLVED_ATTEMPT_READ_FAILED');
    if (data.length === 1000) throw new Error('UNRESOLVED_ATTEMPT_LIMIT_REACHED');
    for (const attempt of data) {
      let finding = attempt.provider_checkout_id ? 'UNVERIFIED_PENDING' : 'UNBOUND_CREATED_REVIEW';
      if (verify && attempt.provider_checkout_id) {
        const response = await fetch(`https://payments.yoco.com/api/checkouts/${encodeURIComponent(attempt.provider_checkout_id)}`,
          { headers: { Authorization: `Bearer ${yocoKey}` }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (response.ok) {
          const checkout = await response.json();
          finding = classifyCheckout(attempt, checkout, domain);
        } else finding = 'PROVIDER_LOOKUP_UNAVAILABLE';
      }
      // This tool is read-only. A provider-completed finding is never payment authority.
      results.push({ domain, attemptId: attempt.id, checkoutId: attempt.provider_checkout_id,
        localState: attempt.state, createdAt: attempt.created_at, finding });
    }
  }
  console.log(JSON.stringify({ status: 'READ_ONLY_YOCO_REVIEW', providerVerified: verify,
    productionMutated: false, attempts: results }));
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  main().catch(error => {
    console.error(JSON.stringify({ status: 'READ_ONLY_YOCO_REVIEW_BLOCKED',
      category: /^(INVALID_|PRODUCTION_|YOCO_|PRIVATE_|TRUSTED_|UNRESOLVED_)/.test(error.message)
        ? error.message : 'PROVIDER_OR_DATABASE_UNAVAILABLE' }));
    process.exitCode = 1;
  });
}
