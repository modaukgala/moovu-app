# Phase 2 live SHADOW observation and reconciliation

Observation date: 11 September 2026  
Production Supabase: `moovu-kasi-rides` (`mvazbszenqahgqpznhhq`)  
Production deployment: `dpl_6pE7H2xHQpCdNyEuiFknGrNCog3i` (READY)  
Immutable cutoff: `2026-09-11 18:04:00 UTC`  
Observation window: `2026-09-11 18:04:00 UTC` through `2026-09-11 18:15:36.571737 UTC`  
Mode: read-only; no production mutation was performed.

## Current health and authority

- Application mode: SHADOW; the Production `MOOVU_PHASE2_FINANCE_MODE` setting remains present on the active deployment.
- Database policy mode: SHADOW.
- `effective_from`: `2026-09-11 18:04:00 UTC`.
- AUTHORITATIVE: OFF.
- Legacy: authoritative.
- 15% and R50: observational only.
- `subscription_required`: true; subscription rules remain authoritative.
- Supabase: `ACTIVE_HEALTHY` before and after the observation query.
- Vercel deployment: READY; no promotion is pending.
- HTTP 402, pause, read-only restriction, or failed deployment condition: none observed.
- Latest available quota reading: egress 2.003/5 GB with zero current overage; grace period ends 19 September 2026. Classification remains **SAFE BUT MONITOR**.

## Natural post-cutoff activity

| Event population | Count |
| --- | ---: |
| Bookings | 0 |
| Accepted/assigned trips | 0 |
| Completed trips eligible for commission SHADOW | 0 |
| Cancellations/no-shows in the observation population | 0 |
| Driver payment reviews | 0 |
| Shadow financial transactions | 0 |
| Shadow reconciliation rows | 0 |
| Historical skips created during this window | 0 |
| Recovered failures | 0 |
| Unresolved failures | 0 |

No genuine event was available for per-source legacy-versus-SHADOW reconciliation. No artificial trip, payment, retry, approval, rejection, cancellation, or completion was created.

## Finance and reconciliation

- Financial accounts / transactions / ledger entries: `0 / 0 / 0`.
- Shadow reconciliation rows: 0.
- Driver commission debt balances: none.
- Unapplied credits: none.
- Expected 10%/12% versus 15% business-policy variances: 0 observed.
- Unexpected technical variances: 0.
- Idempotency/retry evidence from natural production activity: none yet.
- R50 operational restriction: none; no Driver has a Phase 2 balance.
- Subscription behavior: policy remains subscription-required and no post-cutoff event altered actual Driver access.

Historical payment request `e7e165ee-48e1-407b-afac-bf051f9cd080` remains approved for R104.60 with `reviewed_at = 2026-09-06 12:53:20.282831+00`. It still has zero Phase 2 transactions and zero shadow effects. It was not replayed or changed.

## Invariants

All established read-only checks returned zero violations:

- duplicate financial sources: 0;
- unbalanced posted/reversed transactions: 0;
- orphan ledger entries/accounts: 0;
- invalid reversals: 0;
- partial finalized transactions: 0; and
- successfully recovered events left unresolved: 0.

There is no negative debt because no Phase 2 financial account or entry exists. No opening balance, historical backfill, or duplicate financial effect exists.

## Runtime behavior and logs

- Customer surface: HTTP 200.
- Driver surface: HTTP 200.
- Admin surface: HTTP 200.
- Unauthenticated Admin payment-review API: HTTP 401.
- Unauthenticated Driver API: HTTP 401.
- Production logs show normal successful Driver portal/API traffic before the cutoff and expected post-cutoff smoke traffic.
- No relevant Phase 2, RPC, cutoff, recovery-loop, duplicate-notification, HTTP 500, HTTP 402, error, or fatal entry was found.
- No SHADOW regression to booking, dispatch, completion, Driver eligibility, subscriptions, customer pricing, or Admin operations is evident from available traffic. There is not yet a natural post-cutoff business event proving those paths end to end.

## Evidence still required

SHADOW acceptance cannot be recommended from an empty business-event window. Continue read-only observation until natural traffic provides:

1. completed post-cutoff trips with exactly one balanced `trip_commission:<trip UUID>` effect;
2. correct 15% SHADOW commission calculations and classification of the expected legacy 10%/12% variance;
3. evidence that Phase 2 debt and R50 remain observational and do not restrict a Driver;
4. continued authoritative subscription and legacy eligibility behavior; and
5. if one occurs naturally, a post-cutoff Driver payment proving debt-first allocation, unapplied excess credit, non-negative debt, idempotent retry/recovery, and exactly one financial effect.

The approved observation target remains seven days and at least eight naturally completed post-cutoff trips, extended only for low traffic up to fourteen days. A natural commission/combined payment should be observed if one occurs; otherwise record zero opportunities and retain the longer payment-path watch without manufacturing activity.

## Current recommendation

Keep SHADOW active and legacy authoritative. Continue daily quota, event, reconciliation, invariant, and log checks. Do not begin AUTHORITATIVE review until sufficient natural evidence exists. No emergency OFF condition was found in this observation window.

PHASE 2 SHADOW HEALTHY — MORE NATURAL ACTIVITY REQUIRED

## 72-Hour Observation — Missing Trip Investigation

Investigation date: 15 September 2026  
Mode: read-only root-cause analysis; no production repair or configuration change was performed.

### Affected trip and financial expectation

Production trip `53f44a54-5605-42b4-8eea-7c83cf1e25ca` was created and commission-locked at `2026-09-14 12:53:51.678628 UTC` and completed by its assigned Driver at `2026-09-14 13:31:42.237825 UTC`. It is a completed MOOVU Go cash trip with a final fare of R117.00, a valid current-policy snapshot at 1500 basis points, integer-cent-half-up rounding, and an authoritative `trip_completed` business event. The completion used the controlled End OTP bypass reason `Customer phone unavailable/dead`.

The independent calculation is `11700 * 1500 / 10000 = 1755` cents. The legacy-authoritative 10% commission is 1170 cents, so the expected policy variance is +585 cents. That variance is expected under SHADOW. The defect is the continuing absence of both the `trip_commission:53f44a54-5605-42b4-8eea-7c83cf1e25ca` financial transaction and its `phase2_shadow_reconciliations` row.

Three comparison trips posted correctly: OTP trips `ba7b8ab9-2ca3-4454-8842-83e46af4d9a4` and `fc431b2e-b5c3-49c4-9895-51f13a2fd003` produced 1080 and 810 cents respectively, and bypass trip `738c84b0-c7dc-4084-8b3d-15c7ae1b9779` produced 1305 cents. The successful bypass for the same Driver proves the bypass mode and Driver identity are eligible paths.

### Exact application path and production evidence

Both `POST /api/driver/trips/complete` and `POST /api/admin/trips/complete` call `completeTripServer` in `src/lib/trips/completeTripServer.ts`. OTP and bypass differ only in their completion validation inputs. The shared service first resolves `phase2Mode()`, rejects the unimplemented AUTHORITATIVE path, and awaits the legacy `phase05b_complete_trip` RPC through the service-role `supabaseAdmin` client. When the resolved mode is SHADOW, it then awaits `postShadowTripCommission`, which calls `phase2_post_trip_commission` through the same service-role client and `callPhase2Rpc`.

At `2026-09-14 13:31:39.091 UTC`, deployment `dpl_CvPHQCLkWh7WfaDVqqREbuGgLU4P` logged the exact affected request at `POST /api/driver/trips/complete`. The log states that protected RPC `phase2_post_trip_commission` failed with `Bad Gateway`, followed by the structured unresolved record for this trip and source key with `legacyReplayed: false` and `code: operation_failed`. The request returned HTTP 200. This proves that the application mode was SHADOW, the Phase 2 conditional branch ran, the deployed call site was present, and the application attempted the correct RPC after the legacy commit. It also rules out a skipped bypass branch, a deployment/runtime mismatch, and an evidenced database validation or service-role authorization rejection as the primary cause.

Primary root-cause class: **B — Application attempted call but error was swallowed.** The immediate failure was a transient upstream `Bad Gateway` response at the post-commit Supabase RPC boundary. `callPhase2Rpc` converts that response to `operation_failed`; `postShadowTripCommission` logs it and returns without throwing. This is intentional for observational SHADOW availability, but it allows the customer/Driver completion to succeed while the SHADOW side effect remains absent.

One application deployment boundary occurred between the successful R87 bypass and the missing trip: `dpl_CvPHQCLkWh7WfaDVqqREbuGgLU4P` was created at `2026-09-13 01:08:27 UTC` and was active for the missing trip. Its retained runtime log proves that its completion code invoked the correct Phase 2 function. No Phase 4 interaction appears in the failing request, and the later Phase 4 deployment occurred after this trip. The observed `Bad Gateway` explains the gap without attributing it to Phase 4, the deployment's Phase 3 runtime-removal purpose, or the End OTP bypass.

### Recovery analysis and required hardening

The existing recovery contract is safe but request-driven. If an authorized Driver or Admin completion request reaches an already-completed trip while the application remains in SHADOW, `completeTripServer` first replays `phase05b_complete_trip`. The database requires the authoritative `trip-complete:<trip UUID>` business event and rechecks Driver ownership or an allowed Admin role. Only a confirmed legacy replay triggers another `phase2_post_trip_commission` attempt. Legacy commission and completion notifications are not repeated. The Phase 2 posting uses the stable idempotency key `trip_commission:<trip UUID>`, while database uniqueness, the Phase 1 posting contract, and the reconciliation operation key preserve exactly-once financial effect under retries and concurrency.

There is no persisted application recovery marker, automatic retry worker, or background/event-driven reconciliation for this boundary. The log is the only unresolved marker. No later successful recovery occurred because the transaction and reconciliation remain absent. Therefore the current design safely supports recovery when a completion replay is deliberately triggered, but it does not guarantee that a transient post-commit failure will be retried automatically.

The smallest production remediation for this exact trip is a separately approved, authenticated replay through the existing completion route using an authorized actor and the trip's original completion context. A 409 `already completed` response is expected after the service performs the authorized legacy replay and attempts the idempotent SHADOW repair. The operation must then be verified read-only for exactly one POSTED transaction with the stable source key, exactly two balanced 1755-cent ledger entries, exactly one reconciliation row showing legacy 1170 cents versus ledger 1755 cents, and no repeated legacy wallet commission or notification. Do not call the Phase 2 RPC directly from an untrusted client and do not insert ledger or reconciliation rows manually.

Before any AUTHORITATIVE consideration, add a durable post-commit recovery record or transactional outbox entry and a bounded service-role worker that retries unresolved SHADOW sources. Claiming, backoff, terminal error recording, and observability must be persisted; the worker must reuse the stable source key and leave legacy completion success independent of observational SHADOW availability. This closes the silent-permanent-loss weakness while retaining current idempotency.

### Focused regression requirements

- OTP completion: legacy completion commits, the first Phase 2 call returns a simulated gateway/transport failure, the completion response remains successful, recovery retries the stable source, and exactly one 15% transaction plus one reconciliation row results.
- Bypass completion: repeat the same sequence with an allowed bypass reason and prove the bypass path reaches the same recovery behavior.
- Completed-trip replay: require the authoritative completion event and correct Driver ownership or permitted Admin role before retrying; prove legacy wallet commission and notifications stay single-effect.
- Concurrency: run overlapping recovery attempts against PostgreSQL and prove one transaction, two balanced entries, one reconciliation row, non-negative debt, and idempotent subsequent replay.
- Durable recovery: prove a persisted unresolved item survives process termination, is claimed once with safe concurrent workers, retries after a transient `Bad Gateway`, records resolution, and cannot silently disappear after the completion response.

Verdict for this incident: the exact gap is explained and the existing idempotent replay contract provides a safe, separately approval-gated recovery procedure. AUTHORITATIVE remains off. Automated recovery hardening remains required before Phase 2 can rely on this boundary without operator intervention.

## Durable Shadow Recovery and Missing-Trip Remediation

Closure date: 15 September 2026  
Production Supabase: `mvazbszenqahgqpznhhq`  
Production deployment: `dpl_CTZFKvxgHm29c3FDJVRQVrouZLxV` (READY)  
Production domain: `https://moovurides.co.za`  
Phase 2 mode after closure: SHADOW; AUTHORITATIVE remains OFF.

### Durable recovery contract

Migration `docs/phase-2-durable-shadow-recovery.sql` (SHA-256 `5f4afd9cd7711949e3414252053f6ac7fa80bdd7313f10573be36b81920d0aed`) installs `phase2_shadow_recovery_jobs`, a due-work index, and service-role-only enqueue, exact-claim, batch-claim, and finish RPCs. The existing `phase05b_complete_trip` contract now writes the durable `trip_commission:<trip UUID>` recovery identity in the same database transaction as the authoritative completion business event. This applies to OTP, controlled bypass, and authorized Admin completion, including safe completed-trip replay.

The application claims the durable job before its immediate observational post. A protected Vercel cron worker retries due jobs daily and supports manual protected invocation. Processing uses `FOR UPDATE SKIP LOCKED`, a five-minute stale-processing recovery window, exponential backoff from 30 seconds capped at one hour, and a maximum of eight claims. Infrastructure/transport and unavailable-contract failures remain retryable; invalid input, policy mismatch, incompatible contract, and authorization failures become terminal/manual-review evidence. A financial Admin read endpoint exposes job state, attempts, timestamps, error classification, and resulting transaction/reconciliation IDs without exposing secrets.

The queue table has RLS enabled. `public`, `anon`, and `authenticated` have no table access and cannot execute any recovery RPC. `service_role` has read-only table visibility and exclusive RPC execution. No client can insert, claim, finish, or directly post financial recovery work.

### Validation

The connected disposable project `tangtlmdpnvmoviwrgvd` received the exact migration and passed the production-bound implementation. The E2E completed Phase 5-snapshotted R100.00 Driver-basis trips through OTP, bypass, and Admin paths; committed authoritative completion before simulating a `Bad Gateway`; retained retryable durable work; then recovered one R15.00 SHADOW commission per trip. Each result had one POSTED transaction, two balanced 1500-cent ledger entries, one reconciliation, one legacy commission, and one business event. Two simultaneous HTTP/RPC sessions could claim one job only, while two simultaneous posting attempts returned one initial result and one replay result with one economic effect. Replaying completion after success did not reopen or duplicate the job. Phase 5's separate R3.00 service fee did not enter the Driver commission basis. Phase 4 cancellation/no-show tables and functions were unchanged.

Local validation passed: focused recovery/contracts 18/18, final full `npm test` 204/204, `npx tsc --noEmit`, ESLint with zero errors, production build, scoped credential scan with zero matches, and `git diff --check` with no whitespace errors.

### Production installation, deployment, and recovery

Preflight reconfirmed Phase 2 SHADOW at 1500 basis points, R50 observational debt limit, authoritative subscriptions, active Phase 4 contract `phase4-2026-09-owner-v1`, active Phase 5 policy `phase5-2026-09-owner-v1`, a balanced ledger, and an empty recovery queue. The migration installed without changing policy. Deployment `dpl_CTZFKvxgHm29c3FDJVRQVrouZLxV` was built from an isolated release package, became READY, and was aliased to the production domains. The worker rejects missing credentials with HTTP 401; its dedicated sensitive production credential was added without disclosure.

Immediately before recovery, trip `53f44a54-5605-42b4-8eea-7c83cf1e25ca` remained completed with one 1170-cent legacy commission, one authoritative completion event, and zero Phase 2 transaction, ledger, reconciliation, or recovery rows. The authorized completion replay created the durable job, and the protected production worker posted it.

Final affected-trip state:

- legacy authoritative commission: exactly one, 1170 cents;
- Phase 2 transaction: exactly one POSTED ZAR transaction with `trip_commission:53f44a54-5605-42b4-8eea-7c83cf1e25ca`;
- Phase 2 ledger: exactly two entries, 1755-cent debit and 1755-cent credit;
- reconciliation: exactly one, legacy 1170 cents versus SHADOW 1755 cents, expected parity false and expected variance +585 cents;
- recovery job: succeeded after one claim, with both result identities recorded;
- authoritative completion event: exactly one; and
- global POSTED ledger imbalance count: zero.

One additional authorized replay and protected worker invocation produced zero due work and left every count unchanged. A read-only scan of all genuine completed post-cutoff trips with valid Phase 2 commission snapshots found zero remaining transaction/reconciliation coverage gaps. No other trip was repaired.

The recovery reliability gap is closed while Phase 2 remains observational SHADOW. The existing Supabase quota warning and historical security-advisor notices remain separate infrastructure follow-up; neither changes the verified financial result. Natural SHADOW observation remains required before any separately authorized AUTHORITATIVE review.

PHASE 2 SHADOW RELIABILITY GAP CLOSED — SHADOW REMAINS ACTIVE
