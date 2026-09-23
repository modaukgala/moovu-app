# Phase 3 disposable database validation

Date: 2026-09-11
Verdict: **PASSED**

## 1. Executive verdict

The provider-independent Phase 3 schema and invariants passed real PostgreSQL/Supabase validation on disposable project `tangtlmdpnvmoviwrgvd` (`moovu-phase-05g-disposable`). Production project `mvazbszenqahgqpznhhq` was queried only for identity, prerequisite shape, and isolation evidence; it was not mutated and contains no Phase 3 tables or functions.

## 2. Repository state

- Branch: `main`
- Starting HEAD: `87dfec6 Harden P0 dispatch and polling reliability`
- The pre-existing dirty tree was recorded and preserved. No reset, clean, stash, commit, or push occurred.
- Phase 3 files changed in this gate: the migration, its contract-test label, implementation-readiness status, disposable validation SQL, and this report.

## 3. Migration hash and review corrections

- Accepted starting SHA-256: `a71b20a059ea604039d06c34bcb32c0f82980bd8a907ddd8f1f282490ea36be5`
- Final validated SHA-256: `06ad838b67c974b1f53531c9b4d8b1169818fc5dc66e166c1737a17e011e2c25`
- Migration changed during review: **yes**.

Material corrections were limited to Phase 3: payment-state transition enforcement; immutable provider, verification, refund, payable, reconciliation, and ledger-link evidence; provider-scoped refund references; one-to-one ledger links; trip/customer consistency; provider/event consistency; verified-payment and completed-trip checks before Driver payable; safe shared-trigger row access; and a private-schema customer ownership helper for RLS.

The first schema installation was followed by three named disposable corrective migrations as defects were exposed by actual PostgreSQL tests. The resulting disposable schema matches the final local migration. Migration history records the prerequisite, foundation, dispatch-trigger fix, customer-read fix, and private-helper hardening.

## 4. Disposable identity and prerequisite

- Disposable project ref: `tangtlmdpnvmoviwrgvd`
- Project name: `moovu-phase-05g-disposable`
- Status at validation: `ACTIVE_HEALTHY`
- Production project ref: `mvazbszenqahgqpznhhq`
- Confirmed different: **YES**

The disposable already contained the current MOOVU Phase 0/1/2 tables, functions, and ledger. Its only missing Phase 3 prerequisite was `trips.payment_method`. A disposable-only prerequisite copied the production definition verified by read-only catalog inspection: `text NOT NULL DEFAULT 'cash'` with allowed values `cash`, `online`, and `other`. The disposable contained zero trips at that point. This prerequisite was not sent to production.

## 5. Installed objects

Tables: `online_payment_attempts`, `online_provider_events`, `online_payment_refunds`, `online_driver_payables`, and `online_payment_reconciliation_items`.

The catalog confirms 26 primary/unique/supporting indexes, 62 checks/unique/foreign-key constraints, 11 Phase 3 triggers, one customer-read policy, seven public guard/validation functions, and `private.phase3_customer_owns_payment`. RLS is enabled on all five tables. `anon` has no Phase 3 table privilege. `authenticated` has no table-level privilege and only the approved 13 read columns on `online_payment_attempts`; mutation remains service-role-only.

After validation and concurrency cleanup, all five Phase 3 tables contained zero rows. Supabase security advisors reported no Phase 3 finding after the ownership helper moved to the unexposed `private` schema. Remaining advisor findings relate to pre-existing disposable objects or expected unused new indexes before runtime traffic.

## 6. Compatibility and dispatch gates

- Cash and legacy Transfer-compatible `other` trips accepted offers and direct assignment without online-payment rows.
- Online offers and direct assignment failed closed with no payment record and with `CREATED`, `PENDING`, `FAILED`, `CANCELLED`, or `EXPIRED` attempts.
- `SUCCEEDED` without `verified_at` failed its database check.
- A synthetic `FAKE_TEST` `SUCCEEDED` attempt with `verified_at` permitted offer creation and assignment. This is provider-independent test evidence, not a Yoco payment.

## 7. Retries, identities, immutability, and states

- A terminal `FAILED` attempt allowed a new attempt for the same trip/fare version.
- A second concurrent active/effective attempt was rejected by `online_payment_attempts_active_fare_uidx`.
- Same-provider duplicate event identity was rejected; the same raw event ID under a different provider was accepted.
- Checkout and payment references were unique per provider; identical raw references under another provider were accepted.
- Zero cents and non-ZAR attempts were rejected. Monetary database columns are `bigint`; no floating-point money type is used.
- Locked amount/fare, provider identity, verified evidence, and established ledger identity resisted destructive changes. Legitimate `CREATED -> PENDING`, `PENDING -> RECONCILIATION_REQUIRED`, and recovery to `PENDING` succeeded. `SUCCEEDED -> FAILED` failed closed.
- Refund rows remain provider-independent and make no claim about Yoco refund endpoints or raw statuses.

## 8. Authorization

Tests used Supabase SQL roles and JWT claims for `anon`, the owning authenticated customer, a different authenticated customer, and `service_role`.

- The owner could read only the approved columns of owned attempts.
- A different authenticated customer read zero rows.
- Anonymous reads failed for lack of privilege.
- Authenticated mutation failed, including payment success/verification, provider events, refunds, Driver payables, reconciliation, ledger links, and immutable evidence.
- Service authority could perform valid lifecycle operations, while database constraints and triggers still rejected invalid mutations.

## 9. Driver payable and ledger

Payment success before trip completion could not create a Driver payable. After the matching trip was completed with a Driver and `completed_at`, the structural payable seam accepted one row. A duplicate failed on unique trip/payment/idempotency constraints. With zero commission in this structural test, payable equalled the full fare; no processor-fee field reduced it.

A real Phase 1 balanced clearing-only transaction posted inside the rolled-back test transaction. An exact replay returned the same transaction with `replayed=true`; a second online-payment link to that transaction failed; and an unbalanced posting failed atomically. No test recognized commission or other revenue merely because payment succeeded.

The application journal retains the pre-service accounting separation: debit processor clearing and credit customer-funds liability on receipt; only trip completion can later debit held customer funds and credit Driver payable plus the then-authoritative commission. Phase 2's observational 15% is not imported or activated.

## 10. Concurrent-session race

Four genuinely overlapping database sessions were released after the same one-second delay. Against an unverified online trip, the offer insert and direct assignment both failed with `Online payment must be verified before this trip can be dispatched`. Against a Cash trip, two simultaneous offers both succeeded. Cleanup then confirmed zero matching customers, trips, attempts, and offers.

## 11. Rollback and cleanup

Transaction-scoped fixtures use `ROLLBACK`. The committed concurrency fixtures were removed after briefly disabling only the immutable-attempt delete trigger under database-owner authority, then re-enabling it; zero fixture rows remained. A disposable reset can remove the two dispatch triggers, Phase 3 policy/functions, and five tables in foreign-key dependency order. No destructive production rollback script was created.

## 12. Application regression

- Targeted Phase 3 tests: 14 passed.
- Full suite: 184 passed, 0 failed.
- TypeScript: passed (`npx tsc --noEmit`).
- ESLint: passed with 0 errors and 3 pre-existing unused-variable warnings.
- Production build: passed; Next.js generated 171 pages.
- `git diff --check`: passed apart from informational line-ending warnings.
- Credential scan: passed; no credential-shaped value was found in the reviewed repository files.
- No Yoco network request, application deployment, commit, or push occurred.

## 13. Phase 2 and production isolation

Fresh read-only production evidence confirms:

- Application mode: `SHADOW` (unchanged deployment evidence).
- Database mode: `SHADOW`.
- `effective_from`: `2026-09-11 18:04:00 UTC`.
- AUTHORITATIVE: `OFF`.
- Production Phase 1 ledger: 0 accounts / 0 transactions / 0 entries.
- Production Phase 3 tables/functions: none.

The 15% rate, R40 warning, R50 debt limit, subscription eligibility, legacy financial authority, and all Phase 2 production data were unchanged. No deployment or production configuration change occurred.

## 14. Remaining Yoco blocker and next gate

**YOCO CONFIRMATION REQUIRED — DOES NOT INVALIDATE THIS DATABASE RESULT.** Authoritative confirmation is still required for Checkout webhook headers, signed-content construction, secret encoding, Standard Webhooks applicability, authoritative event identity, replay/timestamp semantics, and an official signed fixture.

The next Phase 3 gate is a local/disposable fake-provider server workflow using the validated schema while `MOOVU_ONLINE_PAYMENTS_ENABLED=false`. Do not implement the real Yoco adapter or activate Pay Online until the provider-verification ambiguity is resolved.
