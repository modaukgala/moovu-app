# MOOVU payment-dispatch concurrency resolution

**Verdict: BLOCKED.** The unchanged live and Release 4 payment workers do not acquire a shared pre-dispatch claim. The existing terminal-state guard prevents `DISPATCHED` from reverting to `FAILED`, but cannot prevent a second dispatch attempt before acknowledgement. No production change was made.

## Root cause and side effect

Both the live source `606c8106c074866c3380348d520e5c2aaf5b0aa0` and reviewed source `41892990440d0998e0fb0af9672738816e4f2e2b` have the same `dispatchVerifiedOnlineTrip` and `dispatchTrip` implementation. Cron and the signed Yoco webhook call the former. It reads a `SUCCEEDED` attempt and dispatchable trip, calls `dispatchTrip`, then updates `dispatch_state`. Neither read nor side effect has an atomic owner claim. A competing invocation can pass the same checks before the first acknowledgement. `dispatchTrip` reserves one offer per eligible Driver and then sends offer notifications. Reservation protects an individual Driver and accepted assignment, but does not identify one payment-dispatch invocation or own the whole offer round. A retry after a partially completed round can consider previously untried Drivers and create further offers or notifications. Duplicate trip creation and duplicate financial posting were not observed in this probe; they are not the demonstrated failure.

The first shared database operation creating a new offer is `public.reserve_trip_offer`. It takes a trip and Driver, not a dispatch invocation key. A unique constraint allowing only one call per trip would break MOOVU's legitimate multi-Driver offer round. An attempt-state trigger acts after offers and sends and cannot undo them. The terminal guard migration `20261022120000_online_payment_dispatch_terminal_guard.sql` (SHA-256 `CACAF63290594CCCDF81F32245FF9620CB6941040D57DABDF5032E3C71BE1712`) remains necessary but insufficient.

## Local evidence

On disposable PostgreSQL, `scripts/release4-cross-version-offer-probe.sql` creates a synthetic verified paid trip inside a transaction, keeps its dispatch state `PENDING`, reserves an offer, retries the same Driver, and reserves another eligible Driver. The same Driver is rejected, while a second Driver is offered before payment-dispatch acknowledgement: `SAME_DRIVER_DEDUPED_BUT_SECOND_DRIVER_OFFERED_BEFORE_ACK`. All synthetic changes roll back. This models the shared database contract, **not** a complete old/new HTTP-worker or FCM execution. The existing `test-payment-dispatch-state-guard.ps1` passed `LOCAL_GUARD_TEST_PASS_ROLLED_BACK`; a stale `DISPATCHED -> FAILED` write was rejected. The application source paths are unchanged between live and the Release 4 candidate. No broad regression rerun was warranted because this pass changed only the local probe and report.

| Required case | Result |
| --- | --- |
| Two old, old/new, two new, and webhook/cron overlap | **BLOCKED:** all use the claimless shared path; actual worker/notification concurrency has not passed. |
| Crash before claim / after claim | **BLOCKED:** no claim exists. |
| Crash after offer before acknowledgement, then retry | **Risk demonstrated at the database boundary:** same Driver is protected, another can be offered while attempt stays pending. External notification duplication remains untested. |
| Duplicate signed webhook and recoverable retry | Provider-event idempotency is separate; dispatch ownership is **unproven**. |
| Rollback with an active worker | **BLOCKED:** rollback restores the same claimless code. |
| Stale `DISPATCHED -> FAILED` update | **PASS** locally with the terminal guard. |

## Minimum correction and transition

Prepare a **standalone payment-dispatch reliability release based on the current live source**, before integrating Release 4. Both cron and webhook entry points must use one database-enforced per-attempt claim before `dispatchTrip`. The claim needs a durable owner/lease, compare-and-set completion, bounded stale-lease recovery, and a persisted record of which offer round was started so a crash after reservation cannot open a second round or resend notifications. Reconciliation must inspect authoritative trip/offers and provider state; a lease timeout alone is not permission to repeat side effects. Keep existing per-Driver reservation and notification idempotency. Do not add a process-local lock or a new-only claim and call that cross-version protection.

The live code has no claim token and cannot participate in that contract without an update. During its rollout, old in-flight cron and webhook requests must be proven drained or fenced at the shared database boundary **before** any corrected worker is allowed to execute the same payment attempt. Signed Yoco webhook ingress must remain durably handled; do not simply disable it. An operational pause is acceptable only with verified durable intake/replay and a bounded drain procedure. No such transition has yet been demonstrated. Keep the terminal guard installed through rollback; application rollback must retain additive schema and all legitimate writes.

Before production authorization, rehearse the unchanged-old-to-corrected transition with actual workers against disposable infrastructure. Prove two old, old/new, two new, webhook/cron, crash at each boundary, retry, duplicate webhook, and rollback; assert offer rows, push-job/send attempts, attempt state, trip state, and finance idempotency. Verify the claimed lease can recover without starting a second round. Then review a separate migration and its hash, deploy the standalone reliability patch, verify old requests are drained or fenced, and only then stage Release 4 with both financial flags OFF. No production migration, deployment, live cron call, payment, or notification send occurred in this investigation.

**Remaining release blocker:** a tested shared pre-dispatch ownership and crash-recovery contract plus a safe transition for the unchanged live worker. Status-transition protection alone does not satisfy it.
