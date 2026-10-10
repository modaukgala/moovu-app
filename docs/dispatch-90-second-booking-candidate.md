# 90-second dispatch and booking confirmation candidate

This branch starts at the production source `55c0bb41d9c37f742a2251b7032dabb3eabc699b`. It is **not a dispatch release candidate**. The Customer booking confirmation is local only; the existing dispatch policy is unchanged and remains active in production.

## Confirmed dispatch path

- Cash immediate booking calls `dispatchTrip()` after the idempotent booking RPC. A Pay Online trip becomes dispatchable only after the verified `payment.succeeded` processor; the webhook calls `dispatchVerifiedOnlineTrip()`, and the existing minute recovery cron retries deferred successful attempts. A return page does not authorize dispatch.
- `dispatchTrip()` uses `reserve_trip_offer` for atomic offer creation and `dispatch_jobs` for follow-up work. The protected `POST /api/jobs/dispatch` claims due jobs. Driver offers use `sendPushSafe()` through `driver_accounts`, separate from the disabled Phase 6 notification outbox worker.
- The deployed Vercel configuration schedules online-payment recovery every minute and Phase 2 recovery daily. It does **not** schedule the dispatch worker. Its required `DISPATCH_JOB_SECRET` exists by name in Production, but no active sub-minute invoker was established.
- Current constants are a 25-second offer window, up to three automatic cycles, and a 30-minute search expiry. `dispatchTrip()` can reserve up to 25 candidates in one step, ranked by a composite score rather than strict nearest distance. The current expiry RPC also checks 30 minutes from trip creation.
- The existing expiry path cancels an unassigned trip with no cancellation fee. It does not create or reconcile a refund for a successfully paid trip. The paid-dispatch timer also cannot start from verified payment while the current expiry calculation uses trip creation time.

## Why the 10-second policy remains disabled

[Vercel Cron](https://vercel.com/docs/cron-jobs) uses minute-level expressions and cannot prove dispatch at 10, 20, …, 80 seconds. [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart) documents second-based scheduling, but `pg_cron`, `pg_net`, and Vault are not currently installed in production. A durable, authenticated 10-second invoker and bounded retry/monitoring must be certified before changing the dispatch timing. Do not substitute browser polling or a long-running serverless loop.

The authoritative 90-second deadline needs a reviewed database transition that starts from booking for Cash/Transfer and from verified payment for Pay Online, stops new offers at the deadline, preserves valid outstanding offers, and coordinates with atomic acceptance. A paid trip that finds no Driver needs a durable refund or reconciliation obligation before terminal customer messaging. The existing 30-minute expiry RPC cannot safely be repurposed by changing constants alone.

The candidate-selection and notification policy also needs review for nearest-first sequential expansion, bounded repeat notifications to a single ignored Driver, explicit-decline exclusion, and fair bounded paid priority. Existing acceptance and reservation RPCs should remain the authority.

## Booking confirmation delivered locally

The existing booking page now opens a native modal dialog with route, stops, ride type, quoted total, payment method and disclosed service fee when present. Dismissal creates no trip. Only Confirm Booking calls the existing booking flow; a synchronous in-flight guard blocks double taps. The existing server booking key and Yoco checkout idempotency remain in place. The warning matches the current policy: eligible outstanding fees may need to be resolved before another booking, without claiming they are automatically added to a future fare.

## Release gates

1. Select and provision a durable authenticated worker capable of a measured 10-second cadence, with no new public endpoint or exposed secret. The current `POST /api/jobs/dispatch` remains protected.
2. Review and install the narrow deadline/payment-resolution database changes on disposable first. Preserve the 25-second individual offer window and atomic acceptance. Prove concurrent acceptance, cancellation, duplicate worker claims, and paid refund/reconciliation behavior.
3. Implement and certify nearest-first expansion, bounded retries and paid priority against disposable Auth, Driver and payment fixtures. Measure actual worker timing and direct Driver push delivery; do not send production notifications for tests.
4. Run focused and full regression, TypeScript, lint, build, credential and diff checks. Prepare a separate controlled production migration/worker/configuration approval. Do not deploy this branch until the dispatch and booking requirements are both certified.
