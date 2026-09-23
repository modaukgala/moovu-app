# MOOVU Phase 0.5E disposable database validation

Status: validation evidence captured before disposable-project deletion. This is not production approval and no production SQL was executed.

## Environment

- Disposable project: `moovu-phase-05e-disposable`
- Disposable ref: `hlfeouuvmcsenymnejip`
- Region: `eu-west-1`
- PostgreSQL: `17.6`
- Production ref (excluded): `mvazbszenqahgqpznhhq`
- Data: deterministic anonymized fixtures only

## Migration results

- Baseline fixture: success after identity verification.
- `001` financial foundation: success.
- `002` trip atomicity: success.
- `003` applicant/assignment/outbox: success.
- `004` retention/security: success.
- Replay of `001`-`004`: success; no duplicate schema or financial effects.

## Atomicity and financial results

- Concurrent applicant submission: one driver link, one application; one original and one replay.
- Concurrent payment approval: one settlement; one original and one replay.
- Overpayment: R70 received, R50 applied, R20 preserved as unapplied credit.
- Exact payment: R20 received/applied, R0 due.
- Underpayment: R10 received/applied, R10 due.
- Concurrent trip completion: one commission row; one original and one replay.
- Concurrent customer cancellation: one R20 fee (R13 driver/R7 MOOVU); one original and one replay.
- Concurrent no-show: one R30 fee (R22 driver/R8 MOOVU); one original and one replay.
- Far pickup evidence (111,194.93 m) did not qualify and no-show mutation was rejected.
- Concurrent assignment of one driver to two trips: one success, one hard-eligibility rejection.
- Rollback-injected settlement: zero settlement rows and zero business-event rows after rollback.

## Scale and projection

- 1,101 completed-trip commission rows.
- 100 settlements and 50 eligible credits.
- Authoritative complete-dataset balance: R951.00, matching direct arithmetic.
- Projection refresh returned the same complete-dataset result.

## Permissions and security

- `anon` execution of `refresh_driver_subscription(uuid)`: denied.
- `authenticated` execution of `increment_driver_offer_received(uuid)`: denied.
- Direct authenticated `driver_accounts` insertion: denied.
- Dispatcher settlement mutation: denied.
- Support settlement mutation: denied.
- Owner/Admin service-path financial operations: succeeded.
- New privileged RPCs retain `SECURITY DEFINER`, controlled `search_path`, and service-role execution grants.

## Retention

- Driver deletion with historical references: blocked.
- Trip deletion with trip-event history: blocked.
- Initial wallet deletion unexpectedly cascaded transaction history. This exposed a real `004` defect.
- Local `004` was corrected so `driver_wallet_transactions.wallet_id` uses `ON DELETE RESTRICT`.
- Retest: wallet deletion with transaction history was blocked.

## Outbox

- One stable business event and one outbox row were created.
- Two simultaneous claims returned one processing row and one empty result.
- Completion recorded one delivered outbox row.
- Limitation: no disposable notification worker or external push service was connected. Database claim/idempotency was proven; end-to-end `app_notifications` presentation dedupe remains an activation integration test.

## Fail-closed and application integration

- Offline route tests prove missing/version-mismatched hardened RPCs return controlled failure with no legacy write fallback.
- Unsafe `/api/driver/trip-status` mutation remains disabled by the existing static guard.
- Full browser/API authentication against the disposable project was not configured because production environment variables were intentionally unchanged.

## Validation defects and corrections

1. Financial RPC role checks still allowed Dispatcher/Support. Corrected locally to Owner/Admin and retested.
2. Disposable baseline omitted production `driver_payment_requests.note` and three cancellation audit columns. Corrected only in the fixture and retested.
3. Wallet transaction history still cascaded on wallet deletion. Corrected local retention migration to `RESTRICT` and retested.

## Remaining risks

- P1: end-to-end outbox processor to `app_notifications` dedupe was not executable without a disposable worker integration.
- P1: authenticated HTTP integration was not run because no application environment was repointed.
- P2: broader non-core production cascade relationships need staged review beyond the targeted financial/audit constraints.

## Deletion

Automatic deletion was attempted through the Supabase CLI, but the CLI has no management access token in this environment. The available Supabase connector does not expose project deletion. The project was therefore paused after evidence capture and remains identified as `hlfeouuvmcsenymnejip`; manual deletion is still required in the Supabase dashboard.

Verdict: NOT READY FOR PRODUCTION MIGRATION REVIEW until the remaining authenticated HTTP/outbox limitations are reviewed and the disposable project is deleted. This is not Phase 0 complete.
