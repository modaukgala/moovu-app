# MOOVU durable payment-dispatch ownership

**Verdict: BLOCKED for production cutover; local corrected-worker ownership passed.** Tested patch commits: `e99fa7d73034f562d745921267292c96f2727802` and `8276e25be98b778a92ed572075aba320476e5ad7`. Live source remains `606c8106c074866c3380348d520e5c2aaf5b0aa0`; Release 4 integrated base is `adbb3cc4ede95038d09418634b6f30a22ee8a2f7`. No production SQL or deployment was run.

## Correction

The existing live cron and signed Yoco webhook both call `dispatchVerifiedOnlineTrip`. Previously it read a verified payment, called `dispatchTrip`, and acknowledged afterward without an atomic claim. Separate workers could reserve distinct Drivers before either acknowledgement. The earlier terminal-state trigger prevented only stale `DISPATCHED -> FAILED` writes.

Migration `20261022123000_online_payment_dispatch_ownership.sql` adds a claim token, bounded lease, and durable round ID to the existing payment attempt, plus a round ID on offer rows. The claim function locks the trip before the attempt and selects one canonical successful payment attempt for that booking. A second claim returns `BUSY`; completed dispatch returns `DONE`. The paid-offer wrapper checks the owner and lease in the same transaction as `reserve_trip_offer`, extends the lease, and tags each offer. An offer-insert trigger blocks the unchanged `reserve_trip_offer` path while an active corrected claim exists. Only `service_role` may invoke the new functions; browser roles have no execute grant. The old reservation function and ordinary later dispatch cycles remain available.

Cron and the signed webhook continue to share `dispatchVerifiedOnlineTrip`, which now fails closed if the claim migration is missing. A retry after a claim with no offers can take over and start. If a tagged or legacy offer already exists, it **reconciles that round** and queues its expiry job; it does not select another Driver. A stale token cannot reserve or acknowledge. The expiry job continues the existing trip lifecycle after outstanding offers resolve. A failed scheduler enqueue leaves the claim for lease-based recovery rather than marking dispatch complete. No fare, payment verification, commission, ledger, or 90-second dispatch rule was changed. The 90-second engine is explicitly rejected for this paid-claim path if unexpectedly enabled; both Release 4 financial flags and 90-second dispatch must remain OFF.

The correction prevents competing database offer rounds among corrected workers. It does **not** guarantee exactly-once FCM delivery. A crash after reservation and before the direct push can leave an offer without a push; recovery deliberately does not resend an uncertain push. The Driver offer remains durable and the expiry job is recovered. A controlled notification transport/device test is still required before claiming notification delivery behavior.

## Local evidence

The exact migration order was parsed and rolled back on the original local fixture, then applied to a separate local PostgreSQL database copied from that fixture. The copy restored the relevant public/Auth/dispatch contracts; two unrelated `supabase_vault` extension restore errors mean it is **not** a full managed Supabase clone. The SQL scenarios run inside `ROLLBACK` except the concurrent-claim fixture, which remains in that disposable database because Phase 3 correctly forbids deleting verified payment evidence.

| Scenario | Local result |
| --- | --- |
| Two corrected claims | **PASS:** two-session test returned one `START`, one `BUSY`. |
| Cron/webhook or duplicate webhook using shared coordinator | Same claim path and `BUSY`/`DONE` contract **tested at SQL boundary**; actual HTTP-worker overlap **not run**. |
| Multiple legitimate offers | **PASS:** one owner reserved two different Drivers in one tagged round. |
| Old reservation during active claim | **PASS:** unchanged bare `reserve_trip_offer` was rejected by trigger. |
| Crash before first offer; lease takeover | **PASS:** new token got `START`; old token could not reserve. |
| Crash after offer; lease takeover | **PASS:** new token got `RECOVER`, old token could not reserve or acknowledge, offer count stayed two. |
| Legacy old offer before corrected claim | **PASS:** corrected claim returned `RECOVER` with the offer's actual cycle and added no offer. |
| Distinct successful attempts for same trip | **PASS:** later attempt returned `NOT_AUTHORITY`; canonical attempt got `START`. |
| Stale `DISPATCHED -> FAILED` | **PASS:** existing terminal-guard focused test. |
| Two unchanged old workers before any corrected claim | **BLOCKED:** neither old invocation uses a claim; old-old execution remains unsafe until the live worker is replaced or fully fenced. |
| Actual FCM attempts, process crash, Vercel rollback | **UNVERIFIED:** no live endpoint, provider, or deployment was invoked. |

The full automated suite passed **361/361**; TypeScript passed; ESLint passed with five existing warnings and zero errors; the production build passed with **216/216** static pages using local placeholder Supabase values. Scoped credential scan and Git diff checks passed. These checks certify the code build and local PostgreSQL contract, not managed-service or external delivery behavior.

## Migration and cutover boundary

1. Keep the known-good live deployment available. Verify production migration history and current schema. Apply the existing terminal guard `20261022120000` (SHA-256 `CACAF63290594CCCDF81F32245FF9620CB6941040D57DABDF5032E3C71BE1712`) before ownership migration `20261022123000` (SHA-256 `E403F2E09BB3B8EFAE740FAABC4006FE363D04597EE0F7BEC04913DFD02F324E`). Apply neither without separate production authorization and a reviewed recovery window.
2. Prepare a **standalone compatibility release based on the current live source** containing these two migrations and the focused coordinator, webhook, and paid-reservation changes. Rehearse actual old/old, old/corrected, corrected/corrected, cron/webhook, interrupted worker, and rollback execution against disposable hosted/local API infrastructure. Assert offer rows, jobs, push attempts, payment state, and financial idempotency. A new-only claim is not enough while old workers run.
3. Establish an operational boundary that prevents new claimless paid dispatch while old cron/webhook invocations drain. Keep signed webhook payment evidence durable and reconcile any succeeded-but-undispatched attempts. The current application has no proven way to guarantee that boundary during arbitrary old/old overlap. Do not route traffic to the corrected version until this is demonstrated.
4. After the compatibility release is serving and old invocations are fenced/drained, introduce the integrated Release 4 build with payout and universal-fare flags OFF. Retain both additive migrations through application rollback. Roll back only to the **corrected compatibility deployment**, not the original claimless live deployment; retain all database and financial writes. Never restore an older snapshot over newer transactions.

**Exact remaining blocker:** a verified old-worker drain/fence and actual worker-level failure-injection rehearsal. The local SQL claim and build are ready for that controlled test, but old-old overlap and external notification behavior are not certified. Production promotion is not ready.
