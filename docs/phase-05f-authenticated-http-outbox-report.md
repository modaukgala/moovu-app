# MOOVU Phase 0.5F authenticated HTTP and outbox gap closure

Status: local implementation and validation only. No Supabase SQL was executed, no environment was changed, and no deployment, commit, or push occurred.

## A. Phase 0.5E gap interpretation

Phase 0.5E did not run authenticated Customer, Driver, Admin, Dispatcher, or Support HTTP requests against the disposable Supabase project. It proved database contracts and offline fail-closed behavior, but not the complete HTTP authentication/authorization boundary.

Phase 0.5E proved one outbox row, exclusive claiming, and finish status. It did not prove a worker existed, stale claims recovered, poison retries stopped, `app_notifications` was deduplicated after a crash, or push delivery remained independent from financial mutation. Inspection confirmed no application outbox processor existed before this pass.

## B. Authenticated HTTP matrix

| Operation / route | Authentication and authorization | Authoritative contract / key | Fail-closed and retry result | Notification effect |
|---|---|---|---|---|
| Applicant `/api/driver/apply` | Bearer Auth user; submitted user/email must match authenticated identity | `phase05b_submit_driver_application`; stable Auth user identity | Missing/incompatible RPC returns 503; database replay returns `replayed` | `driver_application_submitted` outbox; legacy immediate notification only while outbox disabled |
| Payment review `/api/admin/payment-reviews` POST | Bearer staff; HTTP role restricted to Owner/Admin | `phase05b_review_driver_payment`; request/status identity | 401 unauthenticated, 403 Dispatcher/Support, controlled RPC error, authoritative replay | `payment_reviewed` outbox |
| Settlement `/api/admin/settlements/record` | Bearer staff; Owner/Admin only | `phase05b_record_settlement`; `manual-settlement:<operationKey>` | Stable key required; no sequential fallback | settlement outbox |
| Subscription financial routes | Bearer staff; Owner/Admin only | activate/payment/update RPCs; prefixed stable operation keys | 401/403/controlled RPC error; replay returned | subscription outbox |
| Admin assignment `/api/admin/trips/assign` | Bearer staff through `requireAdminUser` | existing atomic dispatch `reserve_trip_offer`; dispatch cycle/offer identity | atomic dispatch failure returned; no direct assignment write fallback | existing dispatch notification path; final assignment contract remains a staging regression item |
| Arrival `/api/driver/trips/arrive` | Bearer Driver; `driver_accounts` ownership and assigned trip | `phase05b_mark_arrived`; stable `trip-arrived:<tripId>` event added | 401/403/409/503 as applicable; replay now authoritative | `trip_arrived` outbox added |
| Completion Driver/Admin | Driver bearer ownership or authenticated staff context | shared `phase05b_complete_trip`; stable trip completion event | all financial effects remain one RPC; replay suppresses duplicate immediate sends | `trip_completed` outbox |
| Customer cancellation `/api/customer/cancel-trip` | authenticated Customer and owned customer record | `phase05b_cancel_trip`; `trip-cancel:<tripId>` | ownership enforced in RPC; no direct finance writes | `trip_cancelled` outbox |
| Driver no-show `/api/driver/trips/no-show` | bearer Driver and linked driver ownership | `phase05b_mark_no_show`; `trip-no-show:<tripId>` | location/state/ownership enforced atomically | `customer_no_show` outbox |
| Balance retrieval | authenticated Admin or linked Driver | `phase05b_refresh_driver_wallet` through shared server service | calculation failure returns 500; no client mutation | none |
| Legacy `/api/driver/trip-status` | intentionally disabled | none | always 410; no database client or mutation | none |

## C. HTTP tests

Locally exercised:

- financial role predicate: Owner/Admin accepted; Dispatcher, Support, Driver, and Customer rejected;
- worker requests fail when the dedicated secret is absent or wrong;
- missing RPC, incompatible contract, permission denial, business rejection, and unexpected database failure return controlled failures;
- unexpected database failure invokes the RPC exactly once;
- source-contract checks cover the actual sensitive route files and verify their authoritative RPC names and absence of a legacy fallback branch;
- the disabled legacy endpoint is source-verified as a mutation-free 410 route.

These are offline unit/source-contract tests. They are not real Supabase Auth integration tests.

## D. HTTP fail-closed verification

`callHardenedRpc` performs one RPC call. Missing functions return `contract_unavailable`; wrong versions return `contract_incompatible`; business constraints return `operation_rejected`; permission/unexpected transaction errors return `operation_failed`. Sensitive route source checks reject any contract-unavailable/incompatible branch that starts a table-write fallback. Financial HTTP mutations now reject Dispatcher/Support before RPC invocation.

## E. Outbox architecture

The intended activated path is:

1. hardened database RPC commits finance/trip/application state plus one `moovu_business_events` row;
2. the same transaction inserts one `moovu_notification_outbox` row keyed uniquely by `business_event_id`;
3. `/api/jobs/outbox` claims jobs through `phase05b_claim_outbox` using a dedicated server secret;
4. the worker resolves Customer/Driver/Admin recipients from server-side relationships;
5. `sendPushSafe` upserts `app_notifications` by `(user_id,event_key)` and sends through the existing FCM/Web Push path;
6. the worker acknowledges through `phase05b_finish_outbox`.

`PHASE05_OUTBOX_ENABLED` defaults off. Existing immediate post-commit push remains unchanged until reviewed worker activation. When explicitly enabled, hardened routes suppress immediate push and use durable outbox delivery.

## F. Outbox idempotency

- Business event: unique `event_key`.
- Outbox job: unique `business_event_id`.
- Visible notification: unique `(user_id,event_key)` where the worker key is `phase05:<businessEventId>:<userId>`.
- Retry: reuses the same visible-notification identity and cannot create a second `app_notifications` row.
- Claims: `SKIP LOCKED`, stale `processing` recovery after five minutes, maximum eight claims, exponential bounded retry timing from the existing finish contract.
- Physical push remains at-least-once; a lost provider response can cause another physical push, but never another financial event or visible database-notification identity.

## G. Crash-point analysis

| Point | Result | Evidence status |
|---|---|---|
| A: finance commits before processing | transaction leaves event/outbox durable | guaranteed by migration design; database transaction proven in 0.5E |
| B: claimed before notification | stale processing claim becomes eligible after five minutes | locally prepared and source-tested; real timing requires disposable/staging DB |
| C: notification created before acknowledgement | retry upserts same `(user_id,event_key)` | locally unit/source-tested; real PostgREST conflict behavior requires disposable DB |
| D: push sent, response lost | financial RPC is never replayed; same notification identity reused, physical push may repeat | locally unit-tested at orchestration boundary; provider behavior requires staging |

## H. Remaining environment-dependent tests

### Disposable Supabase required

- apply the corrected migrations from a clean baseline;
- validate the new unique index with representative existing notification rows;
- execute stale-claim recovery and eight-attempt poison parking with real PostgreSQL time/state;
- verify `app_notifications` upsert conflict handling and RLS/grants through PostgREST;
- run authenticated JWT ownership and role requests against real Supabase Auth.

### Deployed staging required

- schedule the worker with `OUTBOX_JOB_SECRET`;
- test activation transition from immediate notifications to outbox with no overlap;
- exercise real Customer/Driver/Admin/Dispatcher/Support HTTP requests;
- inject worker crashes at claim, history-write, push, and acknowledgement boundaries;
- verify actual FCM/Web Push results and notification deep links.

### Controlled production smoke required

- reviewed role/device smoke tests after separately approved migration and compatible deployment;
- one controlled financial replay and one notification delivery per intended recipient;
- monitoring of failed/parked outbox jobs without replaying financial state.

## I. Final migration package consistency

The local package contains Owner/Admin-only financial role checks, server-only RPC grants, wallet-history `ON DELETE RESTRICT`, production-compatible fixture fields, restricted account linking/legacy helper execution, fail-closed contract versioning, stale outbox recovery, bounded attempts, arrival outbox creation, and unique application-notification identity. The package remains unapplied.

## J. Legacy financial evidence

No legacy financial row was modified. The migration still preserves trip commission snapshots, settlements, cancellation credits, wallet transactions, and the two known legacy commission-ledger discrepancies as review evidence. No cached total is treated as historical truth or destructively reconciled.

## K. Validation

Local results:

- targeted authenticated HTTP/outbox tests: 19 passed, 0 failed;
- complete offline suite: 122 passed, 0 failed, 0 skipped;
- TypeScript (`npx tsc --noEmit`): passed;
- lint: passed with 0 errors and the same 3 pre-existing unused-variable warnings;
- production build: passed, 171 application routes/pages generated including `/api/jobs/outbox`;
- `git diff --check`: passed; Git emitted only line-ending conversion notices.

These mock/unit/source-contract results do not replace Phase 0.5E real-database evidence or the remaining environment-dependent tests.

## L. Remaining P0/P1 risks

- P0 gate: corrected migration has not been rerun from a clean disposable database after Phase 0.5F additions.
- P0 gate: no real authenticated HTTP matrix has run against Supabase Auth.
- P0 gate: worker activation and immediate-push cutover have not been staging-tested.
- P1: operational monitoring/UI for eight-attempt parked notifications is not implemented.
- P1: physical push remains at-least-once by provider design.

## M. Disposable project cleanup

`hlfeouuvmcsenymnejip` was paused after Phase 0.5E and requires manual owner deletion. This pass did not access or depend on it.

## N. Next gate

# NOT READY FOR PRODUCTION MIGRATION REVIEW
