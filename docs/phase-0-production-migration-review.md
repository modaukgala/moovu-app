# MOOVU Phase 0 Production Migration Review

**READ-ONLY REVIEW / OWNER APPROVAL PREPARATION / DO NOT EXECUTE SQL**

Review date: 2026-09-02 (Africa/Johannesburg)  
Production project: `moovu-kasi-rides`  
Production ref: `mvazbszenqahgqpznhhq`  
PostgreSQL: `17.6.1.063`  
Repository branch/HEAD: `main` / `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`

## Executive summary

Phase 0.5 disposable validation is complete. The initial production review found migration-package compatibility defects; those defects have now been corrected locally and revalidated against the existing disposable Supabase project using a clean production-compatible baseline. Production review used catalog and aggregate-count `SELECT` queries only. It did not execute a production migration, call a production business RPC, alter production RLS/grants/Auth, write production data, deploy, commit, or push.

Production integrity gates pass. The wallet projection reconciles exactly and no active trip is currently present. The original SQL-contract defects were:

1. `driver_wallet_transactions_tx_type_check` does not allow `cancellation_credit`, but migration 002 inserts that value.
2. `driver_trip_offers_status_check` does not allow `withdrawn`, but migration 002 writes that value.
3. Migration 002 writes `trips.cancellation_reason_details`, which production does not contain and the migration does not add.
4. Migration 002 writes `trips.cancellation_status_at_request` and `trips.cancelled_within_free_window`, which production does not contain and the migration does not add.

The corrected package now installs the required columns and wallet constraint before its RPCs, uses the existing canonical `cancelled` offer status, and safely handles customer Auth actors that do not have a `profiles` row. The affected disposable/database tests passed.

## Repository safety

- Existing worktree preserved: 59 modified/untracked entries were present at review start.
- No reset, clean, restore, stash, commit, push, or deployment was performed.
- This document is the only file created by this review.
- The four migration files remain untracked and unchanged.

## Required migration order

After the blockers are corrected and revalidated, production dependency order is:

1. Run `docs/phase-05-preflight.sql` as separate read-only statements.
2. Run `docs/phase-05d-wallet-reconciliation.sql`; require zero projection differences.
3. Create a final database backup/checkpoint and quiesce financial/trip/application mutations.
4. Apply `docs/phase-05b-001-financial-foundation.sql`.
5. Verify 001 objects, grants, RLS, contract version, and unchanged financial counts.
6. Apply `docs/phase-05b-002-trip-atomicity.sql`.
7. Verify trip trigger, RPC signatures, status constraints, and unchanged historical amounts.
8. Apply `docs/phase-05b-003-applicant-assignment-outbox.sql`.
9. Verify ownership indexes, mutation revokes, assignment RPCs, and outbox claim permissions.
10. Apply `docs/phase-05d-004-retention-security.sql`.
11. Verify retention foreign keys and direct mutation revokes.
12. Deploy the matching application build while traffic remains controlled.
13. Run authenticated owner/admin/driver/customer smoke tests.
14. Keep `PHASE05_OUTBOX_ENABLED` unset until the worker secret, scheduler, delivery, retry, and monitoring checks pass.
15. Enable outbox delivery separately, monitor, and reopen normal traffic.

Do not deploy the hardened application before the RPC package: its protected routes fail closed when the Phase 0.5 RPCs are absent. Do not leave the migrated database serving an old application for an extended period either: migrations 003/004 revoke direct mutations used by legacy paths. Use one coordinated low-traffic cutover.

## Production compatibility and data gates

### Passing gates

| Gate | Result |
|---|---:|
| Duplicate driver-account user links | 0 |
| Duplicate driver-account driver links | 0 |
| Duplicate application user IDs | 0 |
| Duplicate normalized application emails | 0 |
| Duplicate normalized application phones | 0 |
| Orphan driver-account driver links | 0 |
| Orphan driver-account Auth users | 0 |
| Orphan driver profiles | 0 |
| Orphan application Auth users | 0 |
| Duplicate trip commission rows | 0 |
| Duplicate cancellation-fee rows | 0 |
| Completed trips missing final/fare amount | 0 |
| Completed trips missing commission amount | 0 |
| Completed trips without commission ledger row | 0 |
| Commission rows on non-completed trips | 0 |
| Drivers assigned to multiple active trips | 0 |
| Busy drivers without an active trip | 0 |
| Active trips whose driver is not busy | 0 |
| Multiple accepted offers per trip | 0 |
| Duplicate payment-request references | 0 |
| Duplicate settlement references | 0 |
| Existing notification event-key conflicts in JSON data | 0 |
| Completed/assigned trip assignment-history gaps | 0 |
| Wallet projection mismatches | 0 of 50 wallets |
| Maximum wallet projection difference | R0.00 |

Production contained 195 trips, 122 completed trips, 0 active trips, 50 wallets, 129 wallet transactions, 6 settlements, 15 subscription payments, 20 payment requests, 19 cancellation-fee rows, and 8,122 application notifications at the time of the read-only review. All 122 completed trips use a 10% stored commission snapshot.

### Historical evidence that may remain

| Finding | Count | Classification | Treatment |
|---|---:|---|---|
| Active-status offers attached to terminal trips | 159 | Historical operational residue | Preserve; do not make migration approval depend on deleting offer history. Ensure new atomic cancellation withdraws/cancels future offers. |
| Repeated normalized subscription-payment reference | 1 group | Historical evidence | Preserve. New idempotency uses `payment_request_id` and `operation_key`, not legacy free-text reference uniqueness. |
| Legacy commission-ledger differences | 5 wallets | Historical evidence | Preserve. Authoritative complete-dataset projection matches every cached wallet exactly. |

### Expected migration transformations

- Existing `app_notifications` rows receive a nullable `event_key`; existing rows remain valid because the new unique index allows multiple nulls.
- Existing payment/settlement/subscription rows receive nullable idempotency linkage fields and zero-valued applied/excess columns where specified.
- Existing trips receive `financial_version = 0` and nullable arrival-evidence columns.
- Existing `ON DELETE CASCADE` financial/audit foreign keys become `ON DELETE RESTRICT`; no history is deleted.
- New business-event and outbox tables start empty.

### Remediated incompatibilities

| Original defect | Production state | Corrected migration behavior | Status |
|---|---|---|---|
| Wallet transaction type | Check allows `commission`, `payment`, `adjustment` | 002 preflights existing rows, then adds only `cancellation_credit` before RPC installation | Resolved and disposable-proven |
| Driver offer status | Check allows `pending`, `shown`, `accepted`, `declined`, `expired`, `cancelled` | Operational cancellation now writes existing canonical `cancelled`, with cancellation/responded timestamps | Resolved and disposable-proven |
| Cancellation detail column | Column absent | 002 adds nullable `cancellation_reason_details text` before RPC installation | Resolved and disposable-proven |
| Cancellation request-state columns | Both columns absent | 002 adds nullable `cancellation_status_at_request text` and `cancelled_within_free_window boolean default false` | Resolved and disposable-proven |

## Detailed production object changes

### Migration 001: financial foundation

| Object | Current production state | Proposed state and purpose | Risk / reversibility / dependency |
|---|---|---|---|
| `driver_payment_requests` | No operation/applied/excess/contract columns | Add `operation_key`, subscription/commission applied amounts, unapplied excess, contract version | Low rewrite risk on 20 rows; columns reversible only before use; hardened payment-review route depends on them. |
| `driver_settlements` | No request/operation linkage | Add nullable `payment_request_id`, `operation_key`; unique partial indexes | Low data risk; index creation scans 6 rows; financial history must not be removed on rollback. |
| `driver_subscription_payments` | No request/operation linkage | Add nullable linkage; unique partial indexes | Low data risk on 15 rows; one duplicate free-text reference is unrelated. |
| `moovu_business_events` | Absent | New immutable idempotency/event table, RLS enabled, server-only mutation | Medium operational dependency; retain records after activation. |
| `moovu_notification_outbox` | Absent | New durable delivery queue with retry/lock fields, RLS enabled, server-only mutation | Medium; worker must remain feature-flagged until verified. |
| `app_notifications` | 8,122 rows; no `event_key`; broad direct grants; own read/update policies | Add nullable `event_key`, unique `(user_id,event_key)`, replace policies/grants with own SELECT plus service-role mutation | Medium RLS/API cutover risk; old direct read remains, direct user update is removed. |
| Finance tables | Broad table grants currently exist; RLS varies | Revoke direct mutations on wallets, transactions, settlements, subscription payments | High compatibility impact to legacy direct callers; matching server routes required. |
| Legacy helper functions | `refresh_driver_subscription` invoker and broadly executable; `increment_driver_offer_received` SECURITY DEFINER and broadly executable | Server-only execution and fixed search paths; `is_staff` search path hardened | Medium security/compatibility risk; restore prior ACL/config only as emergency rollback. |
| `phase05b_contract_version`, debt/wallet/payment/settlement/subscription RPCs | Absent | Add authoritative SECURITY DEFINER contracts callable only by `service_role` | High cutover dependency; application routes fail closed without them. |

### Migration 002: trip atomicity

| Object | Current production state | Proposed state and purpose | Risk / reversibility / dependency |
|---|---|---|---|
| `trips` | No financial version/arrival-evidence columns | Add version and arrival evidence fields | Low table-rewrite risk on 195 rows; default version is metadata-optimized on PostgreSQL 17. |
| Trip finance trigger | Existing completion/deadline triggers only | Add terminal-finance immutability/version trigger | High behavioral risk; test all legitimate post-terminal admin edits before cutover. |
| Commission/cancellation indexes | Equivalent one-trip indexes already exist under other names | Add duplicate equivalent unique indexes | Low correctness benefit but unnecessary index duplication/lock/storage; package should reuse existing indexes or document why duplicates are retained. |
| Completion RPC | Absent; app currently has non-atomic path in deployed tree | Atomic fare snapshot, commission posting, trip completion, driver release, event/outbox | High financial path; local route depends on exact signature/version. |
| Customer cancellation/no-show RPCs | Absent | Atomic fees, driver offsets, wallet/event/outbox updates | Corrected prerequisites and actor-FK compatibility were disposable-proven. |
| Arrival RPC | Absent | Atomic arrival location evidence and event/outbox | Medium; requires genuine driver ownership and current coordinates. |
| Operational cancellation RPC | Absent | Atomic admin/driver cancellation and canonical offer cancellation | Corrected to the existing production status model and disposable-proven. |

### Migration 003: applicant, assignment, and outbox

| Object | Current production state | Proposed state and purpose | Risk / reversibility / dependency |
|---|---|---|---|
| Driver account/application indexes | `driver_accounts.user_id` is already PK; driver link is uniquely indexed; application user ID not unique | Add/reaffirm one user per account/application | Low on 3 rows; duplicate gates pass. |
| Account/application direct writes | Authenticated own-insert policies and broad grants exist | Remove account insert policy and revoke client mutation; trusted RPC owns linkage | High application cutover risk; new application route must deploy with RPC. |
| Applicant RPCs | Absent | Atomic resumable submission, approval, and link management | High identity-integrity dependency; `driver_profiles(driver_id)` uniqueness and customer Auth contract exist. |
| Assignment RPC | Absent | Lock trip/driver, revalidate eligibility/debt/subscription, assign once, event/outbox | High dispatch path; currently zero active trips lowers cutover risk. |
| Outbox claim/finish RPCs | Absent | Skip-locked claim, stale recovery, eight-attempt poison behavior, finish state | Medium worker risk; service-role only and feature-flagged. |

### Migration 004: retention security

| Object | Current production state | Proposed state and purpose | Risk / reversibility / dependency |
|---|---|---|---|
| `trips`, `trip_events` grants | Broad direct mutation grants; staff RLS policies | Revoke anon/authenticated direct mutations; server/RPC path only | High cutover risk to legacy direct callers; reversible by restoring exact reviewed grants, not broad defaults. |
| Wallet/transaction/settlement/subscription FKs | Driver/wallet deletion cascades | Change to `ON DELETE RESTRICT` | Medium lock and delete-flow impact; preserves financial history. |
| Cancellation-fee/trip-event FKs | Trip deletion cascades | Change to `ON DELETE RESTRICT` | Medium delete-flow impact; preserves fee/audit history. |

## RLS and security review

- All reviewed production tables have RLS enabled, but table grants are broader than the intended hardened contract.
- Existing `app_notifications` policies are `public`-role own read/update. Migration 001 replaces this with authenticated own SELECT and service-only mutation.
- Existing `driver_accounts_insert_own` and `driver_applications_insert_own` permit direct authenticated inserts. Migration 003 removes/revokes those mutation paths.
- Existing finance/trip staff policies call `is_staff()`. Table grants and function ACLs currently expose more mutation surface than the final contract.
- All new Phase 0.5 SECURITY DEFINER functions must retain fixed `search_path=public,pg_temp`, explicit internal authorization where applicable, and service-role-only EXECUTE.
- Production has no `phase05b_*` functions yet, as expected.

## Risk analysis

| Risk | Assessment | Control |
|---|---|---|
| Lock risk | Medium | Run in a low-traffic window. `ALTER TABLE`, constraint replacement, trigger creation, and non-concurrent indexes take locks. |
| Table rewrite | Low | Additive nullable columns and constant defaults on PostgreSQL 17 should avoid full rewrites; confirm execution plans/locks before approval. |
| Long-running statements | Low to medium | Tables are currently modest, but `app_notifications` has 8,122 rows and index/grant changes must be timed. |
| Data loss | Low if package is corrected | Package is additive and retention-focused; never use destructive rollback or history cleanup. |
| RLS/API outage | High | Revokes can break old direct clients; coordinate database and application cutover. |
| RPC cutover | High | New local routes fail closed until exact RPC signatures exist. |
| Active-trip risk | Currently low | Read-only review found zero active trips; recheck immediately before migration. |
| Financial risk | High impact, low current inconsistency | Wallet projection is exact; corrected migration 002 affected paths passed clean-baseline and atomicity proofs. |
| Notification/outbox risk | Medium | Keep delivery flag off until worker and scheduler are authenticated and monitored. |

## Rollback strategy

### Migration 001

- Before any new event/financial mutation: remove new functions/indexes/columns only from a reviewed backup-compatible rollback script, and restore exact prior ACLs/policies.
- After any new event/payment/settlement: do not drop or delete financial/event/outbox rows. Roll back application traffic and use forward reconciliation.
- Keep outbox feature flag off if delivery is unhealthy; financial events remain authoritative.

### Migration 002

- Disable hardened trip routes and restore reviewed prior function/trigger definitions if no new Phase 0.5 trip event has posted.
- After posting, retain trip, fee, wallet, and event history. Correct forward; never rewrite terminal amounts to simulate rollback.
- Trigger rollback must preserve protection for already-terminal Phase 0.5 rows.

### Migration 003

- Restore exact prior account/application grants and policies only if application rollback requires it and security review approves.
- Preserve all ownership links and application/business events. Do not unlink/delete records as rollback.
- Stop the outbox worker and leave jobs pending if delivery must be paused.

### Migration 004

- Schema rollback can restore exact prior FK actions and grants only after confirming no Phase 0.5 history would become cascade-deletable.
- Prefer application rollback plus retained `RESTRICT` protections; retention hardening is intentionally difficult to reverse after financial activity.

## Controlled cutover and decision points

1. Use the corrected four-file migration package reviewed on 2026-09-02; do not substitute the earlier migration 002 content.
2. Preserve the completed disposable PostgreSQL/RLS/RPC evidence; do not infer production execution from TypeScript or mocks.
3. Owner reviews the final SQL diff and this matrix.
4. Schedule a low-traffic maintenance window.
5. Verify production identity/ref and create a recoverable backup/checkpoint.
6. Re-run all read-only gates; stop on any new duplicate, wallet projection difference, or active-trip conflict.
7. Quiesce mutation traffic.
8. Apply 001; verify columns, indexes, tables, RLS, ACLs, function signatures, and financial counts. Roll back/stop on mismatch.
9. Apply 002; verify constraints permit every RPC value, trigger exists, RPC signatures match, and historical trip amounts are unchanged.
10. Apply 003; verify ownership indexes, grants, RPC ACLs, and outbox concurrency contract.
11. Apply 004; verify all seven FK actions are `RESTRICT` and reads still work.
12. Deploy the exact reviewed application build.
13. Smoke test authenticated owner/admin payment paths, driver arrival/completion/no-show, customer cancellation, applicant resume, and unauthorized role denial.
14. Monitor API/database errors, lock waits, duplicate events, wallet differences, and notification backlog.
15. Configure worker secret/schedule; test outbox with the flag off, then separately approve enabling `PHASE05_OUTBOX_ENABLED=true`.
16. Reopen normal traffic only after all gates pass.

## Owner approval matrix

Owner approval is **not granted** by this document.

| Change | Purpose | Production object | Risk | Rollback available? | Downtime? | Owner approval |
|---|---|---|---|---|---|---|
| Financial idempotency columns/indexes | Prevent replay/double posting | Payment, settlement, subscription tables | Medium | Limited after use | Maintenance window | Pending |
| Business event/outbox foundation | Durable, idempotent delivery | Two new tables, app notifications | Medium | Flag/worker rollback; retain history | Maintenance window | Pending |
| Server-only financial RPCs/grants | Atomic privileged operations | Finance functions/tables | High | Prior ACL/function restore before use | Yes, coordinated | Pending |
| Trip atomicity and finance trigger | Single authoritative completion/cancellation | Trips, wallet transactions, fees | High | Forward correction after posting | Yes, coordinated | Pending |
| Applicant/link atomicity | Deterministic ownership | Driver applications/accounts/profiles | High | Policy/app rollback; retain links | Yes, coordinated | Pending |
| Assignment reservation | Prevent double assignment | Trips/drivers/events | High | App/RPC rollback; retain events | Yes, coordinated | Pending |
| Outbox worker RPCs | Safe claim/retry/finish | Outbox functions | Medium | Stop worker/flag | No separate downtime | Pending |
| Retention FKs and mutation revokes | Prevent financial/audit deletion | Finance/trip FKs and grants | Medium/high | Exact reviewed ACL/FK restore only | Yes, coordinated | Pending |

## Production Review Blocker Remediation

### `cancellation_credit` constraint

- **Original defect:** production accepted only `commission`, `payment`, and `adjustment`, while cancellation/no-show RPCs insert `cancellation_credit`.
- **Correction:** migration 002 now aborts on any unknown existing type, replaces the named check with the original three values plus only `cancellation_credit`, and performs this before RPC creation.
- **Disposable proof:** all three old types inserted; `cancellation_credit` posted through customer-cancellation and no-show RPCs; an invalid type was rejected.
- **Production impact:** one brief table lock to replace the check; no existing row rewrite or semantic change.
- **Rollback:** restore the original check only if no `cancellation_credit` row has posted. After use, retain history and roll forward.

### Trip-offer terminal status

- **Original defect:** the RPC wrote `withdrawn`, which production's six-value check rejects.
- **Correction:** operational cancellation uses existing canonical `cancelled` and records `cancelled_at`, `responded_at`, and `updated_at`.
- **Disposable proof:** all six existing statuses remained valid, invalid status was rejected, and customer cancellation converted the active offer to `cancelled`.
- **Production impact:** no constraint or status-model expansion.
- **Rollback:** function replacement only; existing cancelled offer history remains valid.

### Cancellation audit columns

- **Original defect:** three RPC-referenced columns were absent from production and not introduced by migration 002.
- **Correction:** migration 002 adds `cancellation_reason_details text null`, `cancellation_status_at_request text null`, and `cancelled_within_free_window boolean null default false` before function installation.
- **Disposable proof:** all three columns were installed from a baseline where they were absent, and customer cancellation populated request status/free-window audit data.
- **Production impact:** additive/backward-compatible columns; historical text remains null and historical free-window value defaults false.
- **Rollback:** columns can be dropped only before use; after use retain audit evidence and roll forward.

### Customer actor foreign-key compatibility discovered during proof

The clean production-compatible test also proved that customer Auth IDs are not guaranteed to exist in `profiles`, while optional `driver_wallet_transactions.created_by` and `trip_events.created_by` reference `profiles`. The cancellation RPC now writes those optional fields only when a matching profile exists. Customer identity remains recorded in the customer ownership check, cancellation-fee creator, and business-event actor. This prevents a foreign-key failure without weakening authorization or audit history.

### Disposable and local proof summary

- Final baseline plus migrations 001, 002, 003, and 004 applied cleanly in dependency order.
- Correct wallet check contains exactly four values; offer check remains exactly the six production values.
- Three cancellation audit columns and all 20 Phase 0.5 functions installed.
- Customer cancellation and no-show created two fee rows, two credits, and two business events atomically.
- Completion-versus-cancellation concurrency produced one completed state, one commission row, zero fee rows, and one terminal event.
- Unauthorized cancellation returned a controlled failure and left the assigned trip unchanged with zero fee, wallet, or event rows.
- 123/123 offline tests passed; TypeScript passed; lint passed with 0 errors and 3 pre-existing warnings; production build passed with 171 routes; `git diff --check` passed.

## Validation required at controlled production cutover

- Reconfirm the exact production project identity and recoverable backup/checkpoint.
- Rerun the complete read-only gate set and require zero wallet projection differences, ownership/financial duplicates, and active-trip conflicts.
- Apply only the corrected, owner-approved SQL files in the documented order.
- After each migration, verify the expected columns, constraints, functions, ACLs, RLS, foreign keys, and unchanged historical financial counts before continuing.
- Deploy only the exact reviewed application build after database RPC verification.
- Run the authenticated role/path smoke tests and monitor failures, duplicate events, wallet differences, and outbox backlog before reopening traffic.

## Final recommendation

The corrected package is compatible with the current read-only production metadata and data gates. Owner approval may now be requested for the separately controlled production migration. Production remains unchanged and no approval is implied by this document.

# READY FOR OWNER APPROVAL TO APPLY PHASE 0 PRODUCTION MIGRATIONS
