# MOOVU Phase 0.5B migration package

**REVIEW ONLY. NOT APPLIED. DO NOT RUN AGAINST PRODUCTION WITHOUT SEPARATE APPROVAL.**

## Order

1. Run the read-only `phase-05-preflight.sql` queries separately and review every result.
2. Resolve blockers without deleting or rewriting financial history.
3. On an explicitly disposable database, apply `phase-05b-001-financial-foundation.sql`.
4. Apply `phase-05b-002-trip-atomicity.sql`.
5. Apply `phase-05b-003-applicant-assignment-outbox.sql`.
6. Run `phase-05b-disposable-database-tests.sql` only after its placeholders are replaced with isolated fixtures.
7. Apply `phase-05d-004-retention-security.sql` only after disposable delete-flow compatibility is proven.
8. Verify grants, RLS, contract version, wallet reconciliation and outbox idempotency.
9. Configure a dedicated `OUTBOX_JOB_SECRET`, deploy the reviewed outbox worker route, and schedule it in staging while `PHASE05_OUTBOX_ENABLED` remains unset.
10. Verify authenticated route behavior and one `app_notifications` row per `(user_id,event_key)` under worker retry/crash tests.
11. Enable `PHASE05_OUTBOX_ENABLED=true` only after the worker is healthy; this switches hardened routes from legacy immediate push to durable outbox delivery.
12. Obtain separate approval for production activation and a separate approval for the dependent application release.

## Purpose and dependencies

| File | Purpose | Main dependencies | Existing-data risk |
|---|---|---|---|
| `001` | payment review, settlements, subscriptions, complete debt aggregation, durable event/outbox foundation | current finance tables, `profiles`, `drivers` | duplicate operation/payment links; incompatible money/status columns |
| `002` | atomic completion, cancellation, no-show and arrival evidence | `001`, trips, offers, cancellation fees, wallet transactions | duplicate trip finance rows; missing OTP/fare/location columns; terminal history inconsistencies |
| `003` | atomic applicant submission, assignment reservation and outbox claiming | `001`, auth users, applicant/account/profile tables, dispatch tables | duplicate ownership links; orphan applicants; conflicting active trips |

Migration `002` first extends the existing wallet transaction-type check with
only `cancellation_credit` and adds the three nullable/backward-compatible
cancellation audit fields used by its RPCs. Operational offer withdrawal uses
production's existing canonical `cancelled` status rather than introducing a
new offer status. These prerequisites are installed before any dependent RPC.
Customer cancellation keeps the authenticated customer in the fee/business
event audit trail while leaving profile-referenced optional `created_by`
fields null when that Auth user has no `profiles` row.

All three files use additive columns/objects and abort on known duplicate conflicts. They do not contain cleanup SQL.

Phase 0.5D reuses `driver_accounts.user_id -> driver_id` for application ownership and `trip_events.created_at` for assignment/acceptance history. It intentionally does not add `driver_applications.driver_id`, `trips.accepted_at`, or `trips.assigned_at`. The read-only wallet report found zero projection differences under the approved complete formula; legacy commission-ledger differences are retained for review.

## Grants and RLS

New event/outbox objects have RLS enabled. `public`, `anon`, and `authenticated` receive no direct mutation privileges. Hardened functions revoke execution from those roles and grant execution only to `service_role`; API routes authenticate users and authorize roles before invoking them with the server client. Production grants and policies must be compared with preflight output before activation.

Existing account-link mutation, subscription refresh, and offer-counter mutation are also server-only. Existing links and RLS-governed reads remain. Owner/Admin may perform approved financial operations; Dispatcher/Support cannot approve payments, post settlements, or adjust balances.

The outbox is delivery infrastructure. A stable business event produces one delivery job, and the processor deduplicates the user-facing `app_notifications` record by event identity. Delivery retry never repeats a financial mutation.

## Rollback

Before application release, functions can be replaced by reviewed prior definitions and the new routes kept disabled. After any financial event is posted, never drop or delete event, payment, settlement, commission, fee, or outbox history. Rollback becomes a forward reconciliation and application rollback, not destructive SQL. The application deliberately fails closed if a required function is absent or returns another contract version.

## Unresolved owner policy

The approved Phase 0 policy preserves current cancellation/no-show offset economics. Payment excess is retained as unapplied/pending credit, is not lost, and does not automatically reduce unrelated debt or become withdrawable money.
