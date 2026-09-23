# MOOVU Phase 0.5B local hardening report

Date: 2026-09-01. Maximum status: **READY FOR REVIEW-ONLY SQL PREFLIGHT**.

## Boundaries

Local source, review-only SQL, offline tests and build validation only. No SQL was executed, no Supabase project was accessed or changed, and no commit, push or deployment occurred. The SQL package is **NOT APPLIED**. Disposable database tests are **PREPARED BUT NOT EXECUTED**. This is not proof that deployed database atomicity, grants, RLS or concurrency are correct, and Phase 0 is not complete.

Initial repository: `main` at `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`, no staged files. Pre-existing work preserved: modified `docs/dispatch-stale-recovery-migration.sql`; untracked `.codex-local-dev.err.log`, `.codex-local-dev.out.log`, and `documentation/`.

## Previous work preserved

Verified application identity and bearer forwarding, trusted route-metric rejection, commission snapshot validation, financial-history-preserving driver removal, arrival compare-and-set behavior, and controlled Admin route metrics remain in the working tree.

## Local application preparation

- `src/lib/server/hardenedRpc.ts` is the shared fail-closed boundary. Missing RPCs, unsupported `phase-05b-v1` responses, or an unavailable authoritative result return controlled errors. There is no sequential-write fallback.
- Applicant submission and Admin create/link/action routes call database contracts that lock by authenticated user/application, validate ownership and make driver/profile/application/account effects coherent and retryable.
- Payment review, manual settlement, subscription payment, subscription activation and subscription state update routes call atomic, idempotent RPC contracts. UI settlement/subscription actions retain one `crypto.randomUUID()` operation key across failed retries and rotate it only after success.
- Trip completion, customer cancellation, driver/admin operational cancellation, no-show and arrival use transaction contracts. The old `/api/driver/trip-status` mutation bypass now fails closed with `410` because it bypassed Start OTP, arrival evidence and financial completion.
- Admin preassignment invokes the same hard-eligibility reservation contract. If unavailable, the requested trip remains unassigned and an explicit warning is returned; no unsafe assignment fallback runs.
- Wallet projection refresh now uses complete database aggregation rather than fetching an unbounded history into JavaScript.
- Financial commit creates a stable business event/outbox row. Existing immediate push calls happen only after a successful, non-replayed commit. Outbox claim/finish SQL uses `SKIP LOCKED`; production worker scheduling remains a later activation/release concern.

## Review-only database package

All files below are **NOT APPLIED**:

1. `phase-05b-001-financial-foundation.sql`: operation keys, allocation/excess fields, event/outbox tables, complete debt aggregate, wallet refresh, atomic payment review/settlement/subscription functions and server-only privileges.
2. `phase-05b-002-trip-atomicity.sql`: terminal finance immutability/version guard, unique trip finance records, atomic completion/cancellation/no-show/arrival/operational cancellation and server-only privileges.
3. `phase-05b-003-applicant-assignment-outbox.sql`: ownership uniqueness checks, atomic submission/approval/linking, assignment eligibility/reservation, outbox claim/finish and server-only privileges.
4. `phase-05b-migration-package.md`: dependencies, order, risks, grants and nondestructive rollback rules.

The package aborts on known duplicate conflicts; it does not silently clean or rewrite history. New sensitive objects enable RLS, revoke `public`/`anon`/`authenticated`, and grant only `service_role`. API routes still authenticate the user and authorize current roles before server invocation.

## Production preflight

`phase-05-preflight.sql` is **NOT EXECUTED**. It contains catalog/read-only checks for tables, columns/types, functions, grants, RLS, triggers, indexes, incoming/outgoing foreign keys and delete actions, duplicate ownership links, orphan applicants/accounts, duplicate commission/fee rows, payment statuses and scale counts. Results must be reviewed against the real schema before any migration approval.

## Disposable database package

`phase-05b-disposable-database-tests.sql` is **PREPARED BUT NOT EXECUTED**. It refuses to run unless a disposable-database session flag is explicitly set and then deliberately stops until fixture IDs/concurrent sessions are supplied. It specifies applicant, payment, completion, cancellation, no-show, assignment, RLS/grant, outbox and >1,000-row aggregation cases. Mocks and source tests do not prove those database outcomes.

## Financial-history retention

Application deletion no longer explicitly removes wallet history. New event/outbox references use restrictive deletion. Existing deployed foreign-key cascades are not locally provable and remain a mandatory preflight gate; no cascade migration may be approved until actual constraint output is reviewed.

# OWNER DECISIONS REQUIRED

## A. Cancellation / no-show compensation

Current behavior records the driver's share as a `cancellation_credit` that reduces commission owed, even though customer collection is not represented by a future customer-debt ledger.

- Option 1: retain unconditional commission offset. Fastest for drivers; MOOVU carries collection risk.
- Option 2: authorize the offset only after confirmed collection. Lower MOOVU risk; driver value is delayed and requires collection state.
- Option 3: record a pending entitlement then release after collection/manual approval. Best auditability; requires the future two-way ledger expressly excluded from this phase.

Recommendation for later consideration: Option 3. It is **not implemented**. The local SQL preserves the current commission-offset meaning only.

## B. Driver commission overpayment

Current legacy behavior could clip excess. The prepared contract records `amount received`, `amount applied`, and `unapplied excess` so value is not silently lost.

- Option 1: refundable amount.
- Option 2: future commission credit.
- Option 3: manual-review suspense amount.

Recommendation for activation safety: Option 3 until a two-way ledger is approved. No economic disposition is implemented.

## C. Financial role permissions

Current shared Admin authorization permits owner, admin, dispatcher and support to reach financial operations. The prepared SQL preserves that current matrix pending approval.

| Action | Current owner/admin/dispatcher/support | Recommended owner | Recommended admin | Recommended dispatcher/support |
|---|---|---|---|---|
| View operational payment state | yes | yes | yes | limited/read-only |
| Approve/reject payment | yes | yes | yes | no |
| Post settlement/adjust money | yes | yes | controlled | no |
| Activate subscription | yes | yes | yes | no |
| Reverse/correct outcome | no coherent reversal | approval workflow | approval workflow | no |

The recommended matrix is **not implemented** and requires owner approval.

## D. Arrival/GPS threshold

Existing application policy is preserved: straight-line distance at most 20 metres and location age at most 90 seconds. The prepared contract stores only arrival time, pickup/driver coordinate snapshots, calculated distance, source timestamp, qualification and contract version. Missing, stale, future or distant evidence cannot qualify a no-show. Accuracy is not currently available in the inspected table contract and must be reviewed in preflight; no new threshold was invented.

## Remaining gates and risks

- Real schema compatibility, duplicate data, money types, statuses, grants, RLS and cascades are unverified.
- SQL concurrency and rollback injection tests have not run.
- Existing dispatch reservation RPC internals must be compared with the prepared assignment contract before deciding how normal dispatch reuses it.
- Outbox worker deployment/scheduling and post-commit notification delivery need isolated integration tests.
- Authenticated Customer, Driver and Admin regression flows and real device notifications remain required after disposable testing and controlled activation.
- `applyTripCommissionServer.ts` remains as legacy code but the hardened completion route no longer calls it; remove only after repository-wide compatibility review.

## Phase 0.5D production compatibility preparation

- Application ownership reuses `driver_accounts`; no duplicate `driver_applications.driver_id` state is introduced.
- Assignment and acceptance history remains in `trip_events`; nonexistent trip timestamp columns are no longer referenced.
- The five initially reported wallet differences came from a ledger-only comparison that omitted separate settlements. All five cached balances match completed-trip commission minus settlements and eligible credits exactly. Two legacy commission-ledger snapshot differences remain review evidence; no row is changed.
- Direct authenticated account-link and financial mutation privileges are revoked in the review package. Existing links and reads remain.
- Subscription refresh and offer-counter mutations are restricted to server execution; current source callers use server-side Admin clients.
- A separate review-only retention migration changes core financial/audit references from destructive cascade behavior to `RESTRICT`.
- Overpayments remain unapplied credit, current cancellation/no-show economics remain unchanged, and outbox retries are separated from financial mutation.

## Local validation

- Complete discovery of 23 `src/**/*.test.ts` files: **105 passed, 0 failed, 0 skipped**.
- TypeScript (`npx tsc --noEmit`): passed.
- ESLint (`npm run lint`): 0 errors, 3 pre-existing warnings in `documentation/moovu-product-spec/report-template.mjs` and `src/app/admin/(protected)/layout.tsx`.
- Production build (`npm run build`): passed; 170 static pages generated.
- `git diff --check`: passed; only Git line-ending conversion notices were printed.
- Review artifact secret scan: no credential, token, production ID or environment-value matches.

## Next gate

Review `phase-05-preflight.sql`, run its read-only queries separately under explicit authorization, redact any sensitive function bodies before sharing, and compare results with the three migration files. Do not apply SQL or deploy application routes until preflight blockers and owner decisions are resolved. Phase 0 completes only after approved activation, disposable concurrency/RLS tests, deployed contract verification, authenticated regression testing and a separately approved controlled release.
