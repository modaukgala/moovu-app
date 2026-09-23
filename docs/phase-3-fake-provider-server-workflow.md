# Phase 3 fake-provider server workflow

Date: 2026-09-12
Verdict: **BLOCKED for the complete end-to-end gate; local core and disposable SQL integration passed**

## Repository, migration, and target

- Branch main, starting HEAD 87dfec6. The pre-existing dirty tree was preserved. No commit or push.
- Accepted foundation SHA-256: 06ad838b67c974b1f53531c9b4d8b1169818fc5dc66e166c1737a17e011e2c25. Verified before and after; the accepted migration was not changed or reapplied.
- Disposable project: tangtlmdpnvmoviwrgvd, moovu-phase-05g-disposable, ACTIVE_HEALTHY.
- Production project: mvazbszenqahgqpznhhq. Confirmed different: YES. Production was not mutated.
- The five accepted tables and eight prior Phase 3 functions were present with zero payment attempts before this gate.

## Architecture and attempt flow

The deterministic FAKE_TEST provider exists only inside a test file. It produces synthetic checkout and payment references, a pending raw status, and a nonfunctional invalid.example URL; it makes no network request and cannot be imported from a normal runtime module.

The provider-independent server workflow reads a server-held booking and fare, checks customer identity, booking ownership, online method and requested status, converts the server fare to integer ZAR cents, locks a fare-version hash, creates a stable attempt identity, invokes the injected provider, and stores checkout/payment references separately from the internal PENDING state. The client supplies no authoritative amount or success evidence. A checkout uncertainty remains non-dispatchable and marked for reconciliation. The concrete Supabase store implements these operations, but its authenticated HTTP caller is not yet wired.

## Trusted event and accounting

A separate service-role-only trusted normalized-event operation was installed only on disposable. It assumes authentication of the provider event has already occurred; no Yoco signature implementation exists. It atomically records the inbox event, locks the matching attempt, checks provider/checkout/payment references, cents, currency and state, records exceptions, posts through the Phase 1 ledger, and then marks the attempt SUCCEEDED with verified evidence.

Pre-service success debits the existing PAYMENT_CLEARING account and credits a customer-funds liability. It does not recognize MOOVU commission, treat gross fare as revenue, or earn Driver payable. Stable online_payment:attempt-id ledger identity prevents repeated effects. The first disposable run exposed a duplicate Phase 1 account category; the second exposed the extensions.digest namespace; the third exposed immutable event-link ordering. These were corrected only in the separate trusted-event operation. The accepted foundation hash stayed unchanged.

## Scenario results

- Cash and Transfer-compatible other offers succeeded without payment records.
- PENDING online dispatch failed; after a delayed trusted synthetic success, database offer and assignment succeeded with no client return.
- Exact duplicate success returned REPLAYED: one provider event and one balanced ledger transaction.
- Two overlapping workers returned one SUCCEEDED and one REPLAYED. Durable evidence: one event, one transaction, two entries, debit 10,000 cents and credit 10,000 cents.
- A late contradictory FAILED event could not regress a successful attempt and was recorded for reconciliation.
- R90 against R100, USD against ZAR, wrong payment reference, and orphan checkout each failed closed with reconciliation evidence and no affected-trip financial success.
- A FAILED attempt remained auditable and permitted a new attempt for the same fare version.
- Success alone created no Driver payable. After synthetic assignment and completion, one structural payable was permitted. Zero commission was used solely for structural proof; Phase 2's observational 15% was not activated. The locked attempt fare remained unchanged.
- Local application gate tests confirm CREATED, PENDING and FAILED are non-dispatchable, and only verified SUCCEEDED is allowed. The full dispatchTrip function and normal completion route were not invoked against disposable.

## Receipt, Admin, flag, and security

The receipt data model contains trip/payment reference, gross integer cents, ZAR, Pay Online label, provider display name, status, and verified timestamp. It exposes no secrets, card data or private reconciliation metadata and is not a Yoco receipt. A server-only owner/admin read helper exposes booking, attempts, provider references, verification/reconciliation status, ledger link and payable link. No Admin UI was added.

The normal customer feature flag remains fail-closed; the existing booking route rejects Pay Online while disabled. There is no public fake-success route, query bypass, Yoco credential, webhook or network call. Anonymous and authenticated roles have no execute grant on the trusted processor; Supabase advisors report no new processor finding. The remaining security test is an authenticated HTTP checkout and end-to-end ownership/CSRF pass.

## Validation, cleanup, and isolation

- Targeted Phase 3 tests: 18 passed.
- Full suite: 188 passed, 0 failed.
- TypeScript: passed. ESLint: 0 errors, 3 pre-existing warnings. Production build: passed.
- Disposable transactional integration suite: passed; its synthetic rows rolled back.
- Committed race fixtures and the unused test-created account were removed; zero matching customer, trip, attempt, event and financial transaction rows were verified.
- The separate trusted-event operation remains installed only on disposable for continued validation. It has not been reviewed for production. Its FAKE_TEST allowance needs explicit review before any future production migration.
- No production SQL mutation, deployment, Yoco request, commit or push occurred.

Production Phase 2 remains application SHADOW, database SHADOW, AUTHORITATIVE OFF, effective_from 2026-09-11 18:04:00 UTC. The future 15%, R40 warning, R50 limit, subscriptions and legacy financial authority were unchanged.

Yoco still requires authoritative confirmation of Checkout webhook headers, signed-content construction, secret encoding, Standard Webhooks applicability, event identity, replay/timestamp rules and an official signed fixture. This is not the reason for this gate's blocked verdict.

## Exact next gate

Connect a test-only authenticated checkout harness to the concrete disposable store and invoke the actual application dispatch and normal trip-completion paths with notification delivery safely mocked. Repeat the scenarios through that one path, clean every fixture, and review the separate trusted-event SQL as a future production candidate. Keep Pay Online disabled and production untouched.
