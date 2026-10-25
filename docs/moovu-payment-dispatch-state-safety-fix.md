# MOOVU payment-dispatch state safety fix

**Verdict: BLOCKED — terminal-state correction passed locally; cross-version duplicate-claim safety remains unproven and is not provided by the unchanged live worker.** Tested application source: `adbb3cc4ede95038d09418634b6f30a22ee8a2f7`. Live worker source: `606c8106c074866c3380348d520e5c2aaf5b0aa0`. Neither application was deployed or changed in production.

## Root cause and affected contract

`public.online_payment_attempts.dispatch_state` permits `PENDING`, `FAILED`, `DISPATCHED`, `DEFERRED`, and `NOT_REQUIRED`. The payment webhook and every-minute cron both call `dispatchVerifiedOnlineTrip`. That function reads a `SUCCEEDED` attempt, calls `dispatchTrip`, then writes `DISPATCHED` or `FAILED` using only the attempt ID. There is no atomic pre-dispatch claim or compare-and-set. Thus worker A can write `DISPATCHED` and worker B, acting on an older read, can write `FAILED`; the attempt then becomes cron-eligible again. The existing payment-state transition trigger does not govern `dispatch_state`.

`DISPATCHED` is terminal for this dispatch sub-state. A failed *payment* or an authorized refund/cancellation follows the separate `state` transition rules; this migration does not change those rules. Legitimate dispatch `PENDING → FAILED → DISPATCHED` remains allowed.

## Narrow database safeguard

[Migration](../supabase/migrations/20261022120000_online_payment_dispatch_terminal_guard.sql) adds a `BEFORE UPDATE OF dispatch_state` trigger that rejects any `DISPATCHED → other dispatch state` transition with SQLSTATE `23514`. It checks the existing attempt table and immutability trigger, rejects a duplicate guard, and checks managed migration history when that table exists. It creates no table, alters no payment or ledger record, changes no RLS policy, and installs no grant to browser roles. Run it as one bounded transaction under the authorized migration role; record version `20261022120000` only after success. The local fixture has no `supabase_migrations.schema_migrations`, so its history check was structurally tested but managed-history execution remains unverified.

The unchanged live worker can still issue its stale `FAILED` update; PostgreSQL rejects it and preserves `DISPATCHED`. Its existing error path may log/report a dispatch failure, so post-cutover monitoring must distinguish that rejected stale write from a genuinely failed dispatch. The trigger cannot grant old workers an atomic claim before `dispatchTrip`; no database trigger on the eventual attempt update can undo offers or push messages already sent.

## Local test evidence

The existing [pre-fix rollback-only probe](../scripts/release4-cron-cutover-probe.sql) reproduced `PAYMENT_STALE_FAILURE_OVERWRITE_REPRODUCED`. The [post-fix rollback-only harness](../scripts/test-payment-dispatch-state-guard.ps1) loads the migration inside a local PostgreSQL transaction, tests permitted failure/retry and duplicate `DISPATCHED` writes, verifies the stale failure raises `23514`, verifies the state remains `DISPATCHED`, and rolls the migration and fixture changes back. It returned `LOCAL_GUARD_TEST_PASS_ROLLED_BACK`. The local guard trigger is absent afterward. The earlier shadow-recovery probe also passed duplicate claim, stale lease recovery, and single commission-ledger posting; Phase 2 code was not changed.

| Required scenario | Result |
| --- | --- |
| A. Simultaneous workers claim one attempt | **BLOCKED:** unchanged old code has no pre-dispatch claim; the trigger acts only at acknowledgement. |
| B/C. Old→new and new→old retry | Dispatch-state regression **PASS** for the identical old/new update contract; single-owner offer execution **UNVERIFIED**. |
| D. Webhook writes `DISPATCHED` while worker runs | Stale `FAILED` acknowledgement **PASS** locally; webhook/worker external dispatch overlap **UNVERIFIED**. |
| E. Stale `DISPATCHED → FAILED` | **PASS:** rejected, state retained. |
| F. Crash after claim before dispatch | **BLOCKED:** no claim exists in the unchanged old worker. |
| G. Crash after dispatch before acknowledgement | **BLOCKED:** retry can start again; offer constraints help but do not prove one worker owner or no duplicate push to distinct Drivers. |
| H. Duplicate signed webhook | Existing provider-event/idempotency contracts are unchanged; combined webhook-plus-dispatch concurrency **UNVERIFIED** in this fix. |
| I. Rollback during dispatch | Terminal state guard remains database-enforced if migrated, including for old code; in-flight offer ownership **UNVERIFIED**. |
| J. Legitimate recoverable failure and retry | **PASS:** `PENDING → FAILED → DISPATCHED`. |

No full suite, TypeScript, lint, or build rerun was needed because application source did not change. The existing candidate's 361-test release evidence remains separate from this local migration test. No Yoco charge, live cron, production SQL, or Release 4 flag was used.

## Production migration and recovery boundary

Before any production application cutover, independently check the current managed schema/history, review the migration hash, and rehearse the migration against a current isolated schema. Apply with bounded `lock_timeout` and `statement_timeout`, stop on error, and verify the trigger and existing finance invariants. Do not reapply after the version is recorded. A failed uncommitted migration transaction rolls back cleanly. Once installed, retain this additive trigger through application rollback; removing it while old workers can run reopens the proven race. A later removal would require a separately reviewed replacement claim contract and migration.

For an interrupted run, inspect verified attempt, authoritative trip/offer state, dispatch jobs, provider-event evidence, and ledger idempotency keys before retrying. Do not reset a `DISPATCHED` attempt merely because an old worker logged an error. Preserve current production financial records and signed webhook ingress. Never restore an older database snapshot over later legitimate writes.

**Remaining release requirement:** prove or establish one authoritative pre-dispatch claim across old cron, new cron, and webhook paths, or use a verified operational cutover that excludes old/new invocation overlap and drains in-flight dispatch. The current trigger alone is a necessary state guard, not a complete duplicate-dispatch guarantee. Keep `MOOVU_ONLINE_PAYOUTS_ENABLED` and `MOOVU_UNIVERSAL_FARE_23_ENABLED` OFF.
