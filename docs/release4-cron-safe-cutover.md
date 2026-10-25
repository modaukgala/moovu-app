# Release 4 cron-safe cutover decision

> Historical pre-fix investigation. The subsequent database terminal-state guard and remaining duplicate-claim blocker are documented in [moovu-payment-dispatch-state-safety-fix.md](moovu-payment-dispatch-state-safety-fix.md).

**Verdict: FAIL — tested payment-dispatch recovery state regression.** Tested application source: `adbb3cc4ede95038d09418634b6f30a22ee8a2f7`; live source compared: `606c8106c074866c3380348d520e5c2aaf5b0aa0`. No production change was made. This report and its local SQL probe are working-tree evidence, not a new application release commit.

## Existing protections and actual gap

| Path | Existing protection | Result |
| --- | --- | --- |
| Every-minute `/api/jobs/online-payment-dispatch` | Exact `CRON_SECRET` authorization; selects only `SUCCEEDED` attempts with `PENDING`/`FAILED` dispatch and fewer than ten attempts. `reserve_trip_offer` locks trip/Driver rows; partial unique indexes prevent two active offers to the same Driver for one trip or two accepted offers for one trip. Dispatch jobs have a unique `(trip_id, job_type, dispatch_cycle, sequence_number)` key. The cron never creates a Yoco charge or posts commission. | **FAIL:** the attempt is read without an atomic claim. `dispatchVerifiedOnlineTrip` then writes `DISPATCHED` or `FAILED` by ID without checking the current dispatch state. A worker holding an older read can overwrite another worker's `DISPATCHED` state with `FAILED`, making the attempt eligible for another cron retry. Two dispatch attempts can also compete for distinct eligible Drivers; the per-Driver offer constraints do not establish one payment-worker owner. |
| Daily `/api/jobs/phase2-shadow-recovery` | Exact `CRON_SECRET`; Phase 2 OFF skips work. `phase2_claim_shadow_recovery_jobs` atomically claims due rows with `FOR UPDATE SKIP LOCKED`, a five-minute stale lease, and eight-attempt cap. The job has unique operation/trip/event keys. `phase2_post_trip_commission` posts through `phase1_post_financial_transaction` with stable `trip_commission:<trip>` idempotency key and unique ledger transaction key; the finish RPC requires posted transaction and reconciliation evidence. | Local duplicate claim, stale reclaim, interruption after posting, and replay produced one commission transaction. The candidate's added payable step is gated by `MOOVU_ONLINE_PAYOUTS_ENABLED`; with the flag OFF, old and new recovery paths are identical. |
| Signed Yoco webhook | Trusted provider event processing is a separate database RPC with provider-event identity; on a verified Customer success it calls the same `dispatchVerifiedOnlineTrip` function. | Payment settlement is not performed by the cron, but webhook/cron overlap shares the dispatch gap. Do not disable webhook ingress to hide that gap. |

The live and candidate `online-payment-dispatch` route, `dispatchVerifiedOnlineTrip`, `dispatchTrip`, and `vercel.json` are identical. The only changed recovery-worker source adds the disabled online-payable branch. A new-version-only process lock or conditional update cannot protect an in-flight old webhook/cron invocation or an immutable old deployment URL.

## Disposable evidence

Run `Get-Content scripts/release4-cron-cutover-probe.sql -Raw | docker exec -i supabase_db_moovu-release4-local-cert-20261021 psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q` against the existing **local** fixture only. The probe wraps all synthetic records and changes in `BEGIN`/`ROLLBACK`.

| Scenario | Result |
| --- | --- |
| Old success followed by new stale failure, or the reverse (same dispatch implementation) | **FAIL reproduced:** final attempt state becomes `FAILED` after `DISPATCHED`. This is a deterministic stale-read interleaving, not a simultaneous HTTP invocation. |
| Duplicate shadow recovery claim | PASS: second claim receives no job. |
| Worker interruption after commission posting; lease becomes stale; retry and finish | PASS: one posted `trip_commission` transaction, two bounded claim attempts, final job `succeeded`. |
| Ledger replay after rollback/retry | PASS in synthetic local PostgreSQL; no duplicate transaction. |
| Direct simultaneous old/new HTTP cron calls, old webhook/new cron overlap, external push fan-out | **UNVERIFIED**; the proven attempt-state regression already blocks an overlap-safe claim. |

The local probe returned `PAYMENT_STALE_FAILURE_OVERWRITE_REPRODUCED` and `SHADOW_CLAIM_DUPLICATE_STALE_AND_LEDGER_REPLAY_PASS`. Post-rollback local counts remained two trips, two attempts, zero recovery jobs, and six financial transactions. Eighteen focused dispatch/payment/recovery tests passed on the same candidate commit in the integrated checkout, which has installed dependencies. The clean cutover checkout lacks `node_modules`; its direct focused run failed at test startup with missing `typescript`, not a product assertion. No application source changed, so the prior 361-test/typecheck/lint/build evidence remains the applicable broad validation; it was not rerun.

## Correction and cutover boundary

No new-only guard was committed: it would leave the live version unsafe during overlap. The smallest durable correction is a separately reviewed **database-enforced** dispatch ownership/terminal-state contract that both old and new deployments must obey, together with a payment-worker update to use its atomic claim. At minimum it must prevent stale `DISPATCHED` → `FAILED` updates; it must also make one attempt owner authoritative before offer creation, bound abandoned claims, preserve the signed webhook path, and prove replay/rollback behavior. That schema change needs its own migration review, local old/new concurrency rehearsal, and explicit production approval. It is not present in this candidate.

An operational alternative requires an approved, observable quiescence window: disable project Cron Jobs in Vercel Settings, wait for every old online-payment invocation to finish, verify no old webhook dispatch is in flight, promote, verify the routed version, then re-enable jobs and reconcile all `SUCCEEDED` attempts in `PENDING`/`FAILED`. Keep signed webhooks available throughout. During rollback, disable Cron Jobs again, drain, restore the old application only, retain the current database and all financial writes, then re-enable and reconcile. This reduces overlap but has **not** been demonstrated to exclude concurrent webhook dispatch or requests to immutable old URLs, so it is not yet a PASS substitute. Vercel documents possible duplicate/overlapping cron runs, non-interruption of running jobs during deployment, and a project-level Disable Cron Jobs control: https://vercel.com/docs/cron-jobs/manage-cron-jobs . Its cron-management and Instant Rollback pages disagree on whether rollback updates cron configuration; inspect the actual project state after any rollback rather than relying on either claim: https://vercel.com/docs/instant-rollback .

## Bounded recovery, without deleting records

1. For a failed payment-dispatch invocation, inspect the verified attempt, trip state, offer rows, dispatch jobs, and last error. Never create a second payment or mark an attempt `SUCCEEDED` from cron output.
2. If the trip already has an assigned Driver or valid offers, let the authoritative trip/offer state govern. Do not manually reset it merely because the attempt says `FAILED`; classify the attempt-state mismatch for an authorized repair.
3. For a shadow job left `processing`, let its five-minute lease and eight-attempt cap govern reclaim. Verify the stable commission transaction and reconciliation row before acknowledging success. If the cap is reached, escalate for evidence-based manual review rather than deleting or reposting financial records.
4. On worker interruption or application rollback, preserve the current database. Reconcile pending dispatch and shadow jobs after routing and cron state are verified; use existing idempotent replay paths only where their evidence matches.

**Release gate:** Do not stage/promote under a claim of cron-safe old/new overlap until a cross-version database contract or a fully proven quiescent cutover is approved and tested. Both Release 4 financial flags remain OFF; no migration or production configuration was changed.
