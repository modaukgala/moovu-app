# MOOVU P0 Reliability Repair: Local Implementation

Date: 2026-08-30. Repository: `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`.
Baseline: branch `main`, commit `da72656`. No release is authorized by this report.

## 1. Executive Result

Implemented locally: dispatch candidate cap, trip-scoped expiry, bounded notification workers,
progressive job retry decisions, idempotent enqueue, protected read pollers, failure backoff,
jitter, read timeouts, hidden-tab suspension, shared-trip terminal stopping, and GPS heartbeat
overlap/failure protection. Added review-only database retry hardening and verification SQL.

NOT production-complete: the installed RPC/schema has not been inspected remotely and the SQL
has not been applied. PostgreSQL concurrency, real-device workflows, and notification latency
still require staging tests. The five-worker pool bounds concurrent workflows but cannot
guarantee delivery inside 25 seconds when the existing push provider stalls; no unsupported
cancellation or detached Promise.race workaround was introduced.

## 2. Root Cause Addressed

Confirmed code-level amplification paths:

- Dispatch had a configured candidate cap but iterated over the entire ranked list.
- Every dispatched trip ran a global expired-offer update.
- Disconnected driver/customer pollers halved their intervals.
- Read intervals could overlap slow requests and Realtime refreshes.
- Customer location polling depended on the whole changing trip object, restarting on status snapshots.
- Chat subscription effects depended on connection status and could repeatedly resubscribe.
- Shared-trip polling continued every four seconds, including after completion.
- Worker failures requeued after ten seconds without a terminal cap.
- Existing claim SQL incremented attempts atomically but never excluded exhausted jobs.
- Failed heartbeat writes did not update the last-success clock and could be retried every GPS sample.

These are verified defects/risk paths, NOT proof of the historical Supabase outage cause.
That attribution still needs incident-time PostgREST/PostgreSQL, connection, CPU and request metrics.

## 3. Files Changed

All paths below are inside the repository stated above.

| Path | Purpose |
| --- | --- |
| `src/lib/dispatch/config.ts` | Configured notification concurrency of five |
| `src/lib/dispatch/dispatchCandidates.ts` | Aggregate discovery counts, no eligibility changes |
| `src/lib/dispatch/dispatchTrip.ts` | Enforce existing cap, scoped expiry, pool and timing logs |
| `src/lib/dispatch/expireTripOffers.ts` | Shared, independently tested trip-scoped expiry query |
| `src/lib/dispatch/reliability.ts` | Retry delay policy, candidate limiter, settled worker pool |
| `src/lib/dispatch/dispatchScheduler.ts` | Ignore duplicate unique job keys rather than reviving them |
| `src/app/api/jobs/dispatch/route.ts` | Attempts contract, bounded retry and guarded acknowledgements |
| `src/lib/reliability/readPolling.ts` | Reusable controller, delay policy and recursive timer |
| `src/hooks/useReliableRead.ts` | React lifecycle integration and scope cleanup |
| `src/app/driver/page.tsx` | Offer/trip read protection and heartbeat failure/overlap guards |
| `src/app/ride/[tripId]/page.tsx` | Customer status/location read protection, stable location loop |
| `src/components/trip-chat/TripChatPanel.tsx` | Message/unread read protection and stable subscriptions |
| `src/app/admin/(protected)/dispatch/page.tsx` | Board read guard and backoff |
| `src/app/admin/(protected)/dispatch/map/page.tsx` | Map snapshot read guard and backoff |
| `src/app/shared-trip/[token]/page.tsx` | Bounded fallback, hidden suspension, terminal stop |
| `src/lib/dispatch/reliability.test.ts` | Cap, expiry, retry, pool and static SQL contract tests |
| `src/lib/reliability/readPolling.test.ts` | Lock, failure/recovery, jitter, timeout and lifecycle tests |
| `docs/dispatch-job-retry-hardening-migration.sql` | Narrow review-only RPC/trigger hardening |
| `docs/dispatch-stale-recovery-migration.sql` | Existing recovery script respects retry cap/delays |
| `docs/p0-reliability-read-only-verification.sql` | Read-only schema, function and queue inspection |
| `docs/p0-reliability-implementation-report.md` | This handoff and validation record |

No UI markup redesign, dependency, lockfile, environment, native, fare, payment, OTP or RLS changes.

## 4. Dispatch Candidate Cap

Before: every returned eligible driver was reserved/notified.
After: ranked and filtered candidates are sliced using `DISPATCH_CONFIG.maxCandidatesPerStep` (25).
Eligibility, score ordering and the existing atomic reservation RPC are unchanged.
Preferred drivers are filtered before slicing. Admin manual routes increment dispatch cycle;
their new unique job keys remain enqueueable. Offline test covers preferred driver 99 from a 100-row list.

## 5. Offer Cleanup

The expiry query requires matching trip ID, pending/shown status, and deadline <= now.
It does not change another trip, accepted/declined offers, future deadlines, or null deadlines.
Null-deadline legacy cleanup is deliberately not performed globally by dispatch.
An offline query-builder double exercises the actual helper; PostgreSQL behavior remains a staging check.

## 6. Polling Backoff

Seconds below are base delays AFTER request settlement, before bounded jitter.
All critical read polling suspends while the document is hidden. Native notification/location services
are not changed. Realtime events remain enabled and share each read's lock and failure cooldown.

| Read | Previous disconnected delay | Healthy | Disconnected/API healthy | API failures |
| --- | --- | --- | --- | --- |
| Driver offers | 5 | 10 | 15 | 15, 20 max |
| Driver current trip | 5 | 10 | 15 | 15, 20, 30 max |
| Customer trip status | 7.5 | 15 | 20 | 30, 45, 60 max |
| Customer location | 15, plus trip-object effect restarts | 30 | 45 | 45, 60 max |
| Chat messages | 15 | 30 | 45 | 45, 60 max |
| Chat unread | 20 | 45 | 60 | 60 max |
| Admin board | 15 | 15 | 20 | 30, 45, 60 max |
| Admin map | 30 | 30 | 45 | 45, 60 max |
| Shared trip (no Realtime) | 4 | 15 | N/A | 30, 45, 60 max |

Driver local GPS sampling remains two seconds and healthy heartbeat writes remain 30 seconds.
Heartbeat failures now wait roughly 45 then at most 60 seconds; no mutation timeout was added.
UI-only clocks/countdowns still use their original intervals; they do not issue network reads.

## 7. In-Flight Protection

One controller protects each of: driver offers, driver trip, customer status, customer location,
chat messages, chat unread, Admin board, Admin map and shared trip.
Concurrent triggers join the active promise without queuing another read. Locks release in finally.
Realtime cannot bypass a failure cooldown. Controllers survive connection-status changes and reset
on trip/share scope changes; unmount aborts supported reads.
GPS capture and heartbeat writes have separate in-flight refs, also released in finally.

## 8. Jitter and Timeouts

Delay calculation applies +/-10% jitter, clipped at normal minimum and the policy maximum.
Therefore baseline jitter is one-sided at the minimum and final backoff jitter is clipped at the cap.
Time and random sources are injectable in offline tests. Resume after an expired cooldown still
uses a normal bounded delay rather than a tight loop.
Read controllers use a 12-second AbortController timeout, clear the handle, and distinguish
authentication, server, application, transport, and timeout failures. Lifecycle cancellation is
not counted as an API failure. Authentication session APIs themselves do not accept this signal;
an indefinitely stuck session API retains the in-flight lock rather than spawning more reads.
Trip actions, payment, chat send and GPS POSTs have not acquired abort/retry wrappers.
The existing chat GET still marks messages read as before; that idempotent endpoint is unchanged.

## 9. Dispatch Retry Policy

| Failed claimed attempt | Action |
| --- | --- |
| 1 | pending, next run +10 seconds |
| 2 | pending, next run +30 seconds |
| 3 | pending, next run +60 seconds |
| 4 | pending, next run +120 seconds |
| 5 | failed, no requeue |

Success on attempt five still takes the completion path. Worker acknowledgements require the
same ID, processing status and claimed attempt, so an old worker cannot overwrite a cancelled
or reclaimed job. Locks clear when acknowledged; last_error is retained on failure.
Duplicate enqueue is now no-op by the existing unique step key, preserving processing/terminal jobs.

## 10. Atomic Retry Enforcement

Review SQL retains `FOR UPDATE SKIP LOCKED`, due-pending selection, atomic increment and returning
the updated row. It excludes attempts >=5, and converts due exhausted pending rows to failed
in a bounded locked batch. It never pre-emptively fails a processing final attempt.
A trigger prevents terminal-job revival and attempt counter decrease, enforces retry delay
when processing returns to pending, and converts exhausted requeues to failed.
The existing stale recovery script was corrected locally but MUST NOT be rerun blindly: other
sections of that old script modify trip state and are not required for this repair.
No new automatic stale-processing reclaimer was introduced. Verify the existing operational
recovery/cron mechanism in staging and inspect it before applying the patch.

## 11. Notification Concurrency

`DISPATCH_CONFIG.notificationConcurrency = 5`. A dependency-free worker pool awaits each task,
then takes another. Exceptions and reported delivery failures are counted; valid reservations
are not undone. Driver-specific payloads, sound, category, routing and notification text remain intact.
Batch duration and whether the earliest offer deadline was exceeded are logged.
Provider latency is an unresolved gate: a stalled Firebase/web-push call cannot safely be cancelled
by the current API. The pool intentionally does not release detached work, which would violate
the concurrency bound. Verify 25-target delivery latency in staging before production release.

## 12. Database Changes and Order

SQL is REQUIRED for database-enforced retry guarantees, but has NOT been run remotely.
Patch: `docs/dispatch-job-retry-hardening-migration.sql`. Review SQL mirrors the TypeScript limit
of five; the static test protects the current contract. No duplicate attempts column is added.
Function signature, protected search_path and service_role claim grant are preserved.

Required sequence:
1. User runs only `docs/p0-reliability-read-only-verification.sql` and shares results.
2. Compare installed columns, constraints, triggers, indexes and function definitions; review patch.
3. Apply the narrow patch to staging, not the full historic atomic migration.
4. Verify schema/grants and run retry, expiry, assignment and concurrency staging tests.
5. Apply the reviewed patch to production in a controlled window with explicit approval.
6. Verify the installed production definitions.
7. Deploy reviewed application code only after those gates and separate release approval.
8. Run role/device dispatch smoke tests and compare request metrics.

Application retry code can read the existing attempts column, but is not a substitute for the
database guard. Do not publish this as fully hardened without the SQL gate.
Rollback should retain the bounded database guard; restoring an uncapped claim restores the risk.

## 13. Reliability Instrumentation

- Discovery: operation, tripId, discovered count and preliminary count (no driver record payloads).
- Dispatch: correlationId, eligible/processed counts, configured cap, cycle and tripId.
- Notification batch: concurrency, attempted/failed workflows, duration, dispatch duration, deadline exceeded.
- Worker: job/trip ID, attempt/max, retry delay, terminal state, duration and superseded acknowledgement.
- Reads: poller, failure count, elapsed time, next delay, Realtime state, timeout/category and recovery.
- Heartbeat: failure count, duration, backoff and recovery without coordinates.

Healthy read ticks and skipped triggers do not emit per-tick logs. Existing unrelated logging was
not rewritten. No tokens, keys, chat text or location coordinates were added to reliability logs.

## 14. Tests and Validation

- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with three existing warnings in untouched files: two in
  `documentation/moovu-product-spec/report-template.mjs`, one in Admin protected layout.
- `npm run build`: passed; 170 static pages generated. No dev/application server was started.
- `git diff --check`: passed; Git reports normal Windows line-ending notices.
- Node offline suite: 51 tests passed, including 14 new reliability tests.

Re-run the suite from the repository root:

```powershell
node --test --experimental-strip-types src/lib/dispatch/dispatchPolicy.test.ts src/lib/drivers/rideEligibility.test.ts src/lib/trips/lockedTripFare.test.ts src/lib/finance/cancellationFees.test.ts src/lib/notifications/deepLinkRouting.test.ts src/components/trip-chat/composerPolicy.test.ts src/lib/location/liveLocationConfig.test.ts src/lib/server/requestControl.test.ts src/lib/reliability/readPolling.test.ts src/lib/dispatch/reliability.test.ts
```

Coverage includes cap/order/preferred handling, scoped query filters, retry schedule, bounded pool,
slow-request joining, failure cooldown/recovery, reconnect behavior, jitter, hidden/resume/cleanup,
timeout and terminal stopping. Existing fare, cancellation, eligibility, notification routing,
chat composer and request-cache tests remain green. SQL tests are STATIC contract assertions,
not PostgreSQL integration tests; they do not prove two real workers cannot claim the same job.

## 15. Estimated Load Reduction

For 100 returned eligible drivers, reservation/notification workflows fall from 100 to at most25:
75% fewer of those operations per step. Initial discovery and bulk eligibility reads are unchanged.
Simultaneous notification workflows fall from up to100 to5 in that example (95% lower peak),
not a guarantee of 95% lower total database usage.
Shared-trip baseline polls fall from15/minute to roughly4/minute before latency/jitter, then
zero while hidden or after a terminal result. Driver disconnected offer fallback falls from
12/minute to roughly4/minute, and at maximum failure backoff to roughly3/minute plus request time.
These are arithmetic estimates, not measured production outage improvements.

## 16. Regression Assessment

Code inspection: fare/commission/payment/OTP computation, booking mutations, auth checks,
eligibility, atomic assignment implementation, notification payloads and native projects untouched.
Realtime remains authoritative for refresh triggers. Read locks prevent duplicate refresh work,
not user trip actions. Existing GPS write payload/cadence preserved under healthy conditions.
Real customer/driver/admin flows and background/terminated phone delivery were NOT exercised.

## 17. Remaining P1 Work

Measure provider latency and consider a separately reviewed durable notification queue if needed.
Review Admin partial-payload reconciliation/full snapshot costs, server query/index tuning,
cross-instance request coalescing and incident telemetry. Booking surge/nearby polling and other
lower-priority pages were not broadened into this repair. Do not conflate this patch with
distributed Maps protection being installed.

## 18. Production Follow-Up and Manual Checklist

Use staging accounts and fixtures, not live customer rides:
1. Test one, two, three, five and 100 eligible drivers; verify cap, preferred driver and exclusions.
2. Dispatch trip A while B has expired/current/accepted/declined offers; B must not change.
3. Claim due fixtures concurrently from two workers; returned job IDs must be disjoint.
4. Fail attempts1-5; inspect next run times, terminal state and preserved error. Let attempt5 succeed.
5. Attempt stale/duplicate requeue after completion/failure; verify no resurrection or counter reset.
6. Accept the same trip simultaneously from two drivers; exactly one succeeds; verify busy state
   and withdrawal of other offers. Complete and confirm idempotent fare/receipt/commission behavior.
7. Disable Realtime alone; then return HTTP503/timeouts. Measure cadence and max one concurrent read.
8. Recover API, hide/show tabs, navigate between trip/share IDs and unmount; verify cleanup and reset.
9. Check chat read/unread, send, deep links, cancellation, Start/End OTP, receipts and account sessions.
10. Check healthy and failed GPS writes; Android/iOS background location must still operate normally.
11. Measure offer notification p95/max latency for25 targets and multiple devices per driver;
    confirm sound/actions and visible background/locked/terminated delivery on Android and iOS.
12. Compare Supabase/PostgREST connections, request rate, CPU, slow queries, lock waits, queue depth,
    worker errors and expired offers before/after an approved staged rollout.

Deployment readiness: NEEDS CAUTION / not ready for production until SQL and staging gates pass.

## 19. Final Git/Safety State

Pre-existing untracked items preserved: `.codex-local-dev.err.log`, `.codex-local-dev.out.log`,
and `documentation/`. All implementation files are listed above and remain uncommitted.
Baseline remains `main` / `da72656`. No native/generated files or lockfiles are staged for release.

Confirmed: no commit, no push, no deploy, no production SQL, no destructive action,
no test notifications, no app server started, no environment-file edits, and no secrets exposed.
