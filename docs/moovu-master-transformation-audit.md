# MOOVU Master Transformation Audit

Audit date: 23 September 2026 (Africa/Johannesburg)  
Repository: `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`  
Git branch/HEAD: `main` / `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`  
Production Supabase: `mvazbszenqahgqpznhhq` (read-only inspection only)  
Verdict: **ONE COORDINATED IMPLEMENTATION PROGRAMME IS REASONABLE; THE CURRENT DIRTY TREE IS NOT A RELEASABLE UNIT.**

This is an audit, not implementation or release authority. No application feature, SQL, database row, environment variable, feature flag, payment provider, deployment, notification or mobile binary was changed. Evidence classifications used below are: **PRODUCTION VERIFIED**, **LOCAL ONLY**, **DISPOSABLE-TESTED**, **DOCUMENTED**, **MISSING**, **UNKNOWN**, and **OWNER DECISION**.

## 1. Executive Summary

MOOVU already has a substantial coherent core. Production contains the Phase 1 double-entry operational ledger, authoritative Phase 2 Driver commission/debt, active Phase 4 cancellation/no-show finance, active Phase 5 customer monetisation and installed Phase 3 online-payment database primitives. Production read-only evidence on 22 September 2026 shows 13 financial accounts, 29 posted transaction headers, 58 entries, zero imbalanced posted transactions and zero duplicate idempotency keys. Phase 2 is database-authoritative at 15% for Go and Go XL, the new-work debt limit is R50, and Driver subscription is not required.

The principal risk is not missing code; it is **authority drift between Git, the dirty working tree, isolated Vercel releases and production schema**. Local Driver dispatch, status and offer acceptance call `phase6_new_work_eligible`, while production has neither that RPC nor Phase 6 tables. A wholesale deployment of the current tree would therefore fail closed across core Driver assignment. The Git HEAD also does not represent the deployed production overlay.

Phase 3 is an active implementation candidate, not permanently blocked. Provider-independent and Yoco-specific code, signed-webhook verification, checkout idempotency, reconciliation tables and trusted processors exist locally; Phase 3 database objects are installed in production. Production currently has zero Customer online attempts/events/refunds/payables and one Driver online attempt. The remaining authority gate is a controlled real-money pilot proving signed webhook receipt, single posting, dispatch and reconciliation. Secret values were not inspected.

Enhanced experiences E1–E5 are mostly absent. Existing trip chat, push, OTP, sharing, route/fare, audit and location primitives are reusable. They must extend one authoritative trip and financial system. Wait & Return is the highest-risk feature and requires a trip-leg model plus owner-approved waiting/abandonment/payment rules before implementation.

## 2. Repository State

- The tree was already materially dirty before this audit: more than 70 tracked files are modified and many Phase 0–6 source, SQL, reports, tests and logs are untracked.
- The only audit-created repository file is this document.
- The committed HEAD is not a reproducible description of production. Prior reports prove scoped Vercel releases were assembled from isolated production baselines plus approved overlays.
- Phase 6 migrations exist under `supabase/migrations/`, but production migration history ends at Phase 2 authoritative activation after Phase 4/5 migrations. Migration files do not prove deployment.
- Generated/local logs and test evidence must not be bulk-staged with an implementation release.

**P0:** establish a release baseline manifest before implementation: deployed source identity, production migration boundary, intended local overlay, exact hashes and excluded dirty work. Never deploy the whole current tree.

## 3. Current Architecture

The application is Next.js 16 App Router, React 19 and TypeScript with Supabase Auth/Postgres/Storage/RLS, server API routes, Google Maps routing/location, Firebase/Web Push, Capacitor 8 split Customer and Driver shells, and Vercel cron jobs. Customer, Driver and Admin are route groups in one web application, with separate native bundle IDs and server URLs.

Authority direction is generally correct:

`UI -> authenticated API route -> domain/server helper -> guarded RPC -> immutable event/ledger/outbox`.

Violations are mainly transitional duplication: legacy Driver wallets/subscriptions beside Phase 2 ledger authority, immediate push beside the dormant/retryable outbox, legacy cancellation fields beside Phase 4 authority, and multiple generations of onboarding/application tables beside local Phase 6.

## 4. Current Database Architecture

Production read-only inspection verified these transformation groups:

- Identity/operations: profiles, customers, drivers, Driver accounts/profiles/documents, trips, events, offers, dispatch jobs and live-location tables.
- Ledger: `financial_accounts`, `financial_transactions`, `financial_ledger_entries`; positive integer cents, debit/credit entries, immutable guards, idempotency key and posting/reversal RPCs.
- Phase 2: policy, historical exceptions, shadow reconciliation/recovery jobs, commission/payment RPCs and eligibility.
- Phase 3: Customer/Driver payment attempts, provider events, reconciliation items, refunds and online Driver payables.
- Phase 4: policies, quotes, assessments, Customer liabilities, Driver compensations, grace cycles and audited actions.
- Phase 5: policies, memberships/payments, credits/redemptions, referrals and audit events.
- Notifications/audit: business events, notification outbox, app notifications and push-token systems.

All inspected Phase 1–5 privileged RPCs are restricted to `postgres` and `service_role`. No SECURITY DEFINER function lacked a configured search path. Many server-only tables have RLS enabled with no client policy by design; that is deny-by-default, not automatically a defect. The Driver online-payment attempt table has a scoped authenticated SELECT policy through `driver_accounts`. `is_staff()` is public-executable but derives the actor from `auth.uid()`; `rls_auto_enable()` is an event-trigger helper. Both remain security-review surfaces, not confirmed vulnerabilities.

Production has no Phase 6 tables/RPC and no E2–E5 schema.

## 5. Current Trip State Machine

The canonical application statuses are `requested -> offered -> assigned -> arrived -> ongoing -> completed`, with `cancelled` terminal. Offer states are pending/accepted/rejected/expired/cancelled. Arrival, Start OTP and completion are server-controlled; replay is guarded by hardened RPCs and completion idempotency.

Important findings:

- Pickup communication must not add trip states. E1 should create immutable pickup events/chat messages linked to the current trip.
- The current “Schedule” path is inconsistent: booking can submit an initial `scheduled` status while the production trip constraint does not accept it. This is a pre-existing P1 product defect and must be corrected before claiming schedule support.
- Local completion uses a locked fare and explicitly excludes live telemetry from fare recalculation. Stops added after booking can add a locked incremental charge, but route changes cannot reduce/recalculate the locked fare. This differs from earlier desired “actual distance final price” behavior and requires an explicit product/payment decision before alteration.
- Active Driver occupancy is based on assigned/arrived/ongoing; Wait & Return must remain occupied throughout both legs and waiting.

## 6. Current Fare Authority

Server authority is implemented in `src/lib/domain/fare.ts`, `src/lib/fare/calculateFare.ts`, Phase 5 policy RPCs and booking routes. The server recalculates route/fare, snapshots surge and rejects an unexpected Phase 5 total. Current rules include Go/Go XL, distance-tier discount, manual surge capped at 1.4, minimum fares, add-stop increment, stop waiting limits and Phase 5 service fees.

The Customer client cannot choose commission. Admin fare override requires a reason. Online checkout reads the stored server fare and converts to integer cents. The money ledger uses integer cents; legacy trip display columns remain numeric rand values at boundaries.

**P1:** there are multiple fare concepts—legacy embedded booking fee, Phase 5 service fee, locked Driver fare basis, estimated/final fare and add-stop increments. Create one versioned `FareQuote/FareSnapshot` contract before adding Wait & Return or variable final pricing. Do not introduce a second calculator.

## 7. Phase 1 Audit — Financial Ledger

**Status: COMPLETE / PRODUCTION VERIFIED.**

Verified: accounts, balanced transaction headers/entries, integer-cent ZAR amounts, stable idempotency, immutable mutation guards, explicit reversal, source validation, RLS/grants and reconciliation tooling. Production has 29 transactions/58 entries, zero imbalance and zero duplicate keys. Cash collected by Drivers is modelled as Driver activity/commission receivable rather than MOOVU cash received.

Reuse: `phase1_post_financial_transaction`, `phase1_reverse_financial_transaction`, account-ensure/source-validation RPCs, `src/lib/finance/money.ts` and reconciliation SQL. Extend source types for new economic events; never create feature-specific ledgers.

Gap: this is an operational subledger, not statutory accounting. Tax, processor fees/VAT, trust-money treatment and external GL mappings require accountant/legal review.

## 8. Phase 2 Audit — Commission and Driver Finance

**Status: COMPLETE / AUTHORITATIVE DATABASE; RUNTIME CONFIGURATION MUST BE VERIFIED PER RELEASE.**

Production policy: AUTHORITATIVE, 1,500 basis points Go/XL, R50 debt gate, R40 warning, subscription not required, authoritative boundary 15 September 2026 19:04:38 UTC. Cash completion posts exactly one commission debt on the Driver fare basis, excluding Phase 5 service fee. Verified Driver payment reduces debt with idempotent application and unapplied-credit preservation. Active trips may complete after debt reaches the restriction threshold; the threshold prevents new work.

Reuse Phase 2 eligibility everywhere. Remove legacy subscription/wallet authority only through migration and compatibility projection, not ad-hoc route deletion.

**P0:** local dispatch/status/acceptance additionally requires Phase 6 eligibility absent from production. **P1:** Vercel’s sensitive `MOOVU_PHASE2_FINANCE_MODE` cannot be read back via ordinary audit; each release must prove effective runtime/database agreement through an authorized diagnostic or controlled smoke test.

## 9. Phase 3 Online Payments Audit

**Status: PARTIAL — PROVIDER-INDEPENDENT AND YOCO IMPLEMENTED; PRODUCTION REAL-MONEY AUTHORITY NOT YET PROVEN.**

Present locally and/or in production schema:

- server-authoritative Customer checkout and Driver debt checkout;
- stable attempt/fare/obligation version and idempotency keys;
- Yoco Checkout client;
- signed webhook timestamp/signature verification and TEST/LIVE isolation;
- exact checkout/payment/amount/currency binding in trusted RPCs;
- duplicate-event protection;
- reconciliation items, partial-refund model and online Driver payable;
- deferred paid-trip dispatch worker and cron;
- deterministic FAKE_TEST/disposable and signed test webhook evidence.

Production has installed Phase 3 tables and processors, zero Customer online attempts/provider events/refunds/payables and one Driver attempt. Prior deployment evidence says Pay Online UI/routes were deployed, but no owner-authorized Customer LIVE payment completed the full signed-webhook lifecycle. Non-success webhook events are acknowledged but not yet financially processed; refund execution/provider reconciliation and abandoned checkout operational handling remain pilot gates.

Provider-independent readiness: **READY FOR CONTROLLED PILOT**. Yoco-specific readiness: **IMPLEMENTED, LIVE WEBHOOK/PAYMENT EVIDENCE REQUIRED**. Provider activation remains separable from code deployment through explicit runtime feature/mode gates. Do not expose Pay Online merely because credentials are missing/present.

## 10. Phase 4 Audit — Cancellation and No-Show

**Status: COMPLETE / ACTIVE; NATURAL-EVENT RECONCILIATION STILL REQUIRED.**

Production policy is versioned and active: 180-second free window, 300-second no-show wait; Go late R20 split R13/R7, XL late R30 split R20/R10; Go no-show R30 split R22/R8, XL no-show R40 split R30/R10. Server quote/reconfirmation, arrival evidence, liability/grace, Driver compensation, Admin dispute/waiver/reversal and atomic ledger/outbox identities exist. Production currently has zero assessments/liabilities in the inspected snapshot.

Do not duplicate legacy cancellation columns as a second financial authority. New online-payment handling must collect/refund against Phase 4 assessments through explicit provider events and ledger transactions.

## 11. Phase 5 Audit — Customer Monetisation / MOOVU+

**Status: COMPLETE FOUNDATION / ACTIVE POLICY; PRODUCT ADOPTION UNPROVEN.**

Production policy: R99/30 days, no automatic renewal, Go/XL service fees R3/R5, full member waiver, R20/R10 referral rewards, 90-day credit expiry and first eligible completed ride qualification. Ledger-backed memberships, credits, redemptions, referrals and audit exist. Production snapshot contains zero memberships.

Reuse Phase 5 Customer state and quote/create-trip RPCs. Owner must confirm whether the current R99 benefits remain commercially approved before expanding the UI. Do not merge Driver subscriptions with MOOVU+; they are different products and Driver subscription is not an eligibility requirement.

## 12. Phase 6 Audit — Driver Onboarding and Car Scanner

**Status: LOCAL/DISPOSABLE IMPLEMENTATION, NOT PRODUCTION-INSTALLED.**

Local migrations implement enrollments, applications, immutable versions/uploads/reviews, vehicle assignments, manual inspections, operating/retention events, correction/reapplication controls, evidence processing and a fail-closed new-work RPC. Local tests validate SA ID checksum, allowed draft fields, immutable submission/correction behavior, capture checklist, image decoding/metadata removal and role boundaries.

Production has no Phase 6 RPC or tables. Existing Driver identity, legacy applications/documents and trip/financial history must remain. One-active-Driver-per-vehicle and latest-cycle authority are designed locally but not production-authoritative.

**P0:** never deploy current Phase 6 callers before schema installation and compatibility validation. **P1:** resolve legal/operational PrDP treatment; optional application evidence cannot be interpreted as permission to transport passengers unlawfully. Phase 6 needs a frozen migration/source candidate, existing-Driver cohort migration, Storage policy review, disposable connected E2E and separate activation gate.

## 13. Phase 7 Audit — Driver Payables and Payouts

**Status: PARTIAL.**

Online completion payable creation exists through `online_driver_payables` and Phase 3 posting. Existing bank details, manual settlement/payment-review surfaces and Admin reports can be reused. A complete payout domain is missing: no canonical payout batch/attempt/provider abstraction, payout state machine, immutable bank-beneficiary snapshot, failure/retry/reversal workflow, duplicate-payout key or end-to-end reconciliation was proven.

Controlled pilot should initially use manual, dual-controlled payout with ledger posting and reconciliation. Automated payouts remain disabled until provider, cadence, approval roles, fees, failure handling and bank-data retention are approved.

## 14. E1 Pickup Experience Integration

**Status: PARTIAL PRIMITIVES; FEATURE MISSING.** Arrival, 20m pickup checks, GPS heartbeat, chat, push, trip events and OTP exist. Implement one `trip_pickup_events`/business-event contract for predefined Customer/Driver signals, optionally mirrored into chat for UI continuity. Event identity must be idempotent, actor-scoped and active-trip-only. Signals may notify but may not mutate trip/finance/OTP. Retain Driver-arrived as the existing authoritative operation.

## 15. E2 Local Pickup Points Integration

**Status: MISSING.** Address search/map pins exist, but no curated pickup-point schema/Admin CRUD/history was found. Add canonical active/versioned points with service area, routing coordinate, landmark, gate/instructions and Admin audit. Booking must snapshot the selected point’s identity/name/instructions/coordinates onto the trip so historical trips do not change when Admin edits a point. Owner must decide whether routing uses the curated coordinate or only adds instructions.

## 16. E3 Guest Trip Access Integration

**Status: PARTIAL LEGACY SHARING.** Existing `trip_shares`, shared-trip public routes and live location are reusable. There is no unified PASSENGER/WATCHER permission model, token-hash/expiry/revocation contract or “book for someone” ownership separation. Migrate sharing into one `guest_trip_access` domain with hashed high-entropy token, role, explicit permissions, expiry/revocation, rate limiting and safe DTO. Account Customer remains booking/payment owner; passenger identity/notifications remain separate and cannot mutate the trip.

## 17. E4 Lost Item Integration

**Status: MISSING.** Existing completed-trip history, support reports, chat/push/Admin notification infrastructure can be reused. Add a completed-trip-owned case plus immutable status history and mediated messaging. Driver/customer contact data should not be exposed by default. Driver responses and Admin escalation must be actor-audited and idempotent.

## 18. E5 Wait & Return Integration

**Status: MISSING / OWNER DECISIONS BLOCK DESIGN.** Use one trip with ordered immutable/versioned legs and a trip mode, not a parallel trip or a lone boolean. States should separate operational leg/wait progress from canonical trip terminal status. One Driver remains busy for the entire journey. Fare quote, online authorization, cancellation/no-show, OTP, receipts, commission and payable must consume the same leg snapshot.

Owner decisions required before implementation: included waiting minutes, per-minute charge, cap, maximum wait, Customer absence/Driver abandonment, cancellation split by stage, return destination rules, OTP boundaries and online incremental-charge/refund behavior.

## 19. Customer UI Integration

The Customer app already has map-first booking, trip status, chat, sharing, safety audio, history, account/payment and MOOVU+ surfaces. Extend the existing app shell. Add feature-gated entry points for guest booking, curated pickup points, pickup quick signals, lost items and Wait & Return. Each must include loading/empty/error/offline/permission states. Do not expose raw ledger/provider/internal IDs. Pay Online controls must be hidden or disabled when activation health is false.

## 20. Driver UI Integration

The Driver app has map-first offers, active-trip controls, navigation, OTP, chat, earnings, commission payments, subscriptions/account and onboarding surfaces. Preserve one active-trip panel. Add pickup signals inside that panel, Phase 6 onboarding as a gated replacement journey, and payout status under earnings. Wait & Return requires leg-aware navigation and a clear waiting clock without freeing the Driver for new offers.

## 21. Admin Integration

Admin already covers dispatch, trips, Drivers/applications/documents, payments, subscriptions, commission, settlements, reports, receipts, notifications and Phase 4/5 surfaces. It needs a consolidated operations/finance command model rather than more disconnected pages: provider reconciliation, payout queue, pickup-point management, guest-access revocation, lost-item cases, Phase 6 review/version comparison and Wait & Return leg history. Every override needs reason, actor, idempotency key and immutable audit event.

## 22. Notifications and Realtime

FCM/Web Push registration, role targeting, deep links, invalid-token cleanup, native actions, in-app alerts, trip/admin polling and a retryable database outbox exist. Production outbox currently has 168 rows; this count alone does not prove worker activation or delivery health. Immediate notifications remain alongside outbox-gated delivery, creating duplicate/lost-delivery risk if activation is inconsistent.

Adopt one canonical notification intent per business event/user. Financial/trip transactions enqueue intent atomically; workers deliver at least once with stable visible identity. Keep provider delivery separate from the financial transaction. Add observability for pending/claimed/terminal age, FCM response categories and token/app-role mismatch. Physical iOS/Android closed-app delivery remains a real-device gate.

## 23. Mobile / Capacitor Impact

Customer and Driver are correctly split as `za.co.moovu.customer` and `za.co.moovu.driver`, with separate web directories/server URLs and push presentation settings. New camera/scanner, background location, push actions and deep links affect native entitlements, privacy descriptions and store declarations. Native sync/build/signing and physical-device QA must follow web validation; Windows cannot certify iOS signing/APNs delivery.

## 24. RLS / Security Findings

- Financial/provider/Phase 1–5 privileged functions are service-role-only and have protected search paths: PASS.
- Client payment attempt SELECT is owner-scoped through Driver account mapping: PASS.
- Public guest routes already exist and must be replaced/extended with hashed tokens, least-privilege DTO, expiry, revocation and rate limits: P1.
- Phase 6’s fail-closed security model is appropriate but currently creates source/schema deployment coupling: P0.
- All client-supplied actors, amounts, roles, review states and evidence metadata must continue to be ignored/allowlisted server-side.
- Run a full policy/grant diff and Storage bucket policy audit on the frozen implementation candidate. RLS-with-no-policy is intentional for server-only tables only if client grants remain revoked.

## 25. Concurrency / Idempotency Findings

Ledger posting, commission, Driver payment, trip completion, offer acceptance, payment events, refunds, Phase 4 decisions and Phase 5 operations contain stable idempotency/locking contracts and extensive disposable race tests. Do not weaken them. Missing new feature contracts must define stable identities before UI implementation: pickup signal, guest invitation, lost-item transition, leg transition, waiting charge, payout attempt and reconciliation import.

## 26. Legacy / Duplicate Systems

| System | Classification | Action |
| --- | --- | --- |
| Legacy Driver subscription eligibility | DEPRECATE | Keep history/UI only; never gate work in AUTHORITATIVE Phase 2. |
| Driver wallet/balance caches | MIGRATE/PROJECTION | Reconcile from ledger; do not treat as money authority. |
| Legacy commission posting | DEPRECATE | Preserve historical snapshots; no double-write after authoritative boundary. |
| Phase 2 SHADOW recovery | KEEP FOR BOUNDED RECOVERY | No new SHADOW economics; retire only after reconciled retention decision. |
| Legacy cancellation columns/fees | PROJECTION | Phase 4 assessment/liability is authority. |
| Immediate push plus outbox | MIGRATE | One durable intent path; keep controlled fallback during cutover. |
| Legacy Driver applications/documents | MIGRATE | Preserve evidence/history; map to immutable Phase 6 versions. |
| Existing trip sharing | MIGRATE | Fold into guest access; revoke old tokens through controlled compatibility. |
| Fare calculators/snapshots | CONSOLIDATE | One versioned quote/snapshot contract; preserve legacy read compatibility. |
| Manual bank-transfer subscriptions/commission | KEEP | Separate Driver payment workflows; Phase 2 debt is authority. |
| Old payment experiments | REMOVE LATER | Only after code/reference/data inventory and retention review. |

## 27. Data Migration Requirements

Preserve Auth UUIDs, Customer/Driver IDs, trips, OTP/event history, financial snapshots/ledger, payment/provider records, Driver applications/documents, vehicle assignment and Admin audit. Required migrations are additive and versioned:

1. Release-baseline reconciliation and current profile/identity P0 repair.
2. Phase 6 legacy Driver/application/document/vehicle mapping with immutable source references and cohort activation.
3. Legacy wallet/subscription/commission projection reconciliation, never historical recomputation.
4. Existing share tokens to guest-access compatibility/revocation mapping.
5. Existing saved/local locations only after canonical pickup-point deduplication.
6. No backfill for lost items/Wait & Return unless actual historical source evidence exists.

Every migration needs preflight counts, collision report, idempotent rerun, transaction/lock bounds, postflight and rollback/forward-correction plan.

## 28. Testing Gaps

- No current production-like connected E2E covers the entire dirty tree because production lacks its Phase 6 dependency.
- No owner-authorized LIVE Customer Yoco payment proves webhook -> ledger -> dispatch -> completion -> payable -> refund/reconciliation.
- No natural Phase 4 production event or Phase 5 membership adoption was observed in the current snapshot.
- No Phase 7 payout E2E exists.
- E1–E5 lack contracts/tests because they are absent.
- Scheduled rides remain broken by status constraint mismatch.
- Real-device iOS/Android push, background location, native deep link and scanner capture require device tests.
- Current local suite is strong but cannot prove remote RLS/concurrency/deployment configuration.

## 29. Observability / Recovery

Reuse business events, operation records, reconciliation rows, notification outbox and stable reference IDs. Add dashboards/alerts for: booking/dispatch error ratio; offer age/exhaustion; stuck active trips; unresolved finance recovery; ledger imbalance; duplicate-key conflict; payment attempt age; unmatched provider event; refund age; payable/payout age; outbox backlog/terminal failures; Phase 6 review SLA; guest-token abuse; lost-item SLA. Recovery must replay idempotent operations, never edit financial history.

## 30. Online Payment Activation Readiness

Provider-independent architecture: **READY FOR CONTROLLED PILOT**.  
Yoco adapter: **IMPLEMENTED; REAL LIVE CUSTOMER EVIDENCE MISSING**.  
Production activation blockers: explicit feature/health gate, verified webhook registration/secret at runtime, owner-approved small payment, signed event/reconciliation proof, duplicate-return/webhook-order test, refund authority/process, support runbook and manual rollback/disable switch. Provider credentials must remain server-only and are not documented here.

## 31. One-Shot Implementation Feasibility

**YES as one coordinated engineering programme; NO as one atomic production release.** Shared contracts and the current architecture support one implementation run with a frozen baseline, internal migrations, contract tests and feature gates. Attempting to merge every dirty local feature and activate it simultaneously would create unacceptable trip, finance and rollout risk.

## 32. Recommended Internal Implementation Order

1. Freeze/reconcile production source and complete the P0 Customer identity/booking/dispatch recovery without Phase 6 coupling.
2. Define canonical versioned contracts: trip events/legs, fare snapshot, financial source identities, guest permissions and activation health.
3. Install Phase 6 schema/compatibility in dormant mode; migrate existing Drivers; validate; then separately gate new-work authority.
4. Harden/activate Phase 3 controlled Customer online pilot and reconciliation; keep Cash unchanged.
5. Complete Phase 7 manual payable/payout control before automation.
6. Consolidate durable notification intent/outbox and observability.
7. Implement E1 pickup events.
8. Implement E2 curated pickup points and trip snapshots.
9. Implement E3 unified guest access and migrate sharing.
10. Implement E4 lost-item workflow.
11. Implement E5 trip legs/Wait & Return only after owner policy and payment authorization decisions.
12. Cross-system disposable E2E, mobile/device QA, staging pilot, read-only production preflight, explicit approvals and staggered activation.

## 33. Feature Activation / Gating Strategy

Separate **code present**, **schema installed**, **configured**, **pilot allowlisted**, and **production enabled**. Use server-side database policy/version plus deployment env agreement, failing closed. Recommended independent gates: online Customer payment, Driver online debt payment, Phase 6 new onboarding, Phase 6 new-work enforcement, MOOVU+, durable outbox delivery, pickup signals, curated pickup points, guest booking/sharing, lost items, Wait & Return, manual payout and automated payout. Clients read sanitized capability health; they never decide authority.

## 34. Production Deployment Strategy

Create an isolated candidate from the verified production source, overlay only reviewed programme files, bind it to exact migration hashes, run local/disposable/staging gates, then deploy dormant features. Apply additive SQL before callers only when backward-compatible. Activate one capability/cohort at a time with metrics and rollback criteria. Never deploy from this dirty tree. Never combine SQL execution, env mutation, provider activation and full traffic activation into one irreversible step.

## 35. Rollback Strategy

Prefer feature disable and forward correction. Database rollback may remove only empty/unactivated additive objects; never delete financial, trip, identity, application or audit history. After economic events exist, reverse through explicit ledger/provider operations. Keep previous verified Vercel deployment, but confirm schema compatibility before promotion. Phase 6 rollback disables enrollment/new-work enforcement while retaining immutable evidence. Guest/pickup/lost-item/Wait & Return gates must allow old clients to continue core trips.

## 36. Owner Decisions Required

1. Confirm Phase 5 R99 membership price/benefits and launch timing.
2. Approve the first controlled LIVE Yoco Customer payment, maximum amount, refund authority and support owner.
3. Approve payout cadence, minimum, fees, dual-control roles, beneficiary-change hold and manual-to-automated progression.
4. Resolve PrDP/legal operational eligibility versus application submission grace.
5. Confirm Phase 6 existing-Driver cohorts, grace periods and whether each cohort may work during correction.
6. Decide whether curated pickup points change routing coordinates or only add instructions.
7. Approve guest Passenger/Watcher data, permissions, token lifetime and notification consent.
8. Approve lost-item retention, escalation SLA and any return fee.
9. Decide Wait & Return included wait, rate, cap, maximum wait, abandonment/cancellation policy, OTP stages and online incremental-payment/refund approach.
10. Decide whether final trip fare remains locked plus approved additions or may decrease/increase from metered actual distance; define tolerance and Customer consent.

## 37. Blocking Issues

| Severity | Finding | Consequence | Remediation / dependent work |
| --- | --- | --- | --- |
| P0 | Local dispatch/status/offer acceptance require absent production Phase 6 RPC. | Whole-tree deploy can block Drivers/new trip assignment. | Isolate P0 baseline; install/validate dormant Phase 6 before enabling callers. Blocks Phase 6 release and any bulk deployment. |
| P0 | Git/dirty tree/deployed source/schema are not one reproducible release. | Cannot attribute or safely roll back production behavior. | Build signed source+SQL manifest from verified deployment baseline. Blocks master release. |
| P1 | Customer profile/booking P0 recovery is validated separately but not established here as production-applied. | Existing Auth-backed Customers may fail booking. | Fresh read-only count/preflight and separately approved atomic P0 package. Blocks broad Customer rollout. |
| P1 | Scheduled status conflicts with production constraint. | Schedule booking fails safely but is unusable. | Choose requested+schedule_status authority or add a fully supported canonical status, then E2E. |
| P1 | No real LIVE Customer Yoco lifecycle evidence. | Money may succeed externally without internal dispatch/reconciliation proof. | Controlled low-value pilot with signed webhook and ledger verification. Blocks general Pay Online activation. |
| P1 | Phase 7 payout domain incomplete. | Online Driver money can become payable without safe settlement automation. | Manual dual-control pilot and canonical payout state/idempotency/reconciliation. Blocks scaled online payments. |
| P1 | Fare authority product conflict: locked fare versus desired actual-distance adjustment. | Customer consent/payment/refund and Driver payout can diverge. | Owner policy plus versioned quote/finalisation contract before E5 or variable charging. |
| P1 | Public sharing is not yet unified least-privilege guest access. | Excess location/PII/token exposure risk. | Hashed scoped expiring tokens, DTO and rate limits before E3. |

## 38. Non-Blocking Issues

- Three current lint warnings (documentation template and Admin layout).
- Node test runner repeatedly reparses TypeScript tests because package module type is unspecified; performance/noise issue only.
- Immediate push and outbox coexist; migration should be deliberate.
- Production server-only RLS tables without policies require periodic grant audit.
- Natural Phase 4 and Phase 5 adoption evidence is sparse.
- UI consolidation and accessibility/device QA should follow domain contracts, not lead them.

## 39. Expected Implementation Change Surface

### DATABASE

`supabase/migrations/20260916*_phase6_*.sql`, later additive migrations for pickup events/points, guest access, lost items, trip legs/waiting and payouts; existing Phase 1–5 SQL/RPCs must be extended, not copied.

### SERVER

`src/lib/trips/*`, `src/lib/dispatch/*`, `src/lib/drivers/phase6*`, `src/lib/server/*`, booking/Driver/Admin API routes. Reuse hardened RPC wrapper, canonical attempt history, OTP completion and business-event identity.

### CUSTOMER

`src/app/book/page.tsx`, `src/app/ride/[tripId]/*`, history/account/payment/shared-trip routes and Customer shell components.

### DRIVER

`src/app/driver/*`, onboarding, active-trip components, earnings/payment and offer/status routes.

### ADMIN

`src/app/admin/(protected)/*`, Driver review, trips/dispatch, finance/reconciliation, notifications and new operational queues.

### PAYMENTS / FINANCE

`src/lib/payments/*`, `src/app/api/payments/*`, `src/lib/finance/*`, Phase 1–5 RPCs. Reuse trusted Yoco event processing, payment attempts, refund/reconciliation and ledger posting.

### NOTIFICATIONS

`src/lib/push-server.ts`, `src/lib/push-notify.ts`, `src/lib/notifications/*`, `src/app/api/jobs/outbox/route.ts`, native deep-link/action handlers.

### MOBILE

`capacitor.customer.config.ts`, `capacitor.driver.config.ts`, iOS/Android entitlements/manifests, Firebase plist/json, scanner/location permissions and native assets.

### TESTS / DOCUMENTATION

Extend current finance, dispatch, payment, Phase 6, notification and route contract tests; add real PostgreSQL race suites, authenticated cross-role E2E, device matrix, deployment manifests and operating runbooks.

## 40. Final Readiness Verdict

**AUDIT COMPLETE. IMPLEMENTATION MAY BE PLANNED AS ONE COORDINATED PROGRAMME, SUBJECT TO THE P0/P1 GATES AND OWNER DECISIONS ABOVE.**

Do not begin by adding E1–E5 UI. First freeze the production baseline, repair/reconcile booking authority, establish canonical shared contracts and remove source/schema deployment ambiguity. Deploy dormant code and schema through internal gates, then activate capabilities separately. The current dirty working tree is **NOT READY** for production deployment.

## Implementation Matrix

| Area | Current state | Evidence | Reuse | Change required | Risk | Dependencies | Test requirement | Activation gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Booking/dispatch | PARTIAL | Real APIs/RPCs; frozen P0 99/0; production still lacks local Phase 6 RPC | Phase 5 create-trip, canonical offers | Apply isolated P0; decouple/install Phase 6 | P0 | Identity, fare, eligibility | Auth Go/XL full lifecycle, races | P0 production approval |
| Trip lifecycle/OTP | COMPLETE core | Hardened arrive/start/complete and replay tests | Existing RPCs/events | Add event/leg extensions only | P1 for E5 | Fare, payment, finance | Concurrent transitions/OTP replay | Per-feature |
| Fare | PARTIAL | Server calculator + Phase 5 snapshot; locked completion | Existing rules/snapshot | Canonical versioned quote; decide metered policy | P1 | Payment/refund/E5 | Boundary/property/E2E | Policy version |
| Phase 1 ledger | COMPLETE | Production tables/RPCs, 29/58, zero imbalance | All Phase 1 functions | Extend source types/reconciliation | P0 if bypassed | All money features | PostgreSQL concurrency/invariants | Always authoritative |
| Phase 2 commission | COMPLETE | AUTHORITATIVE 15%, R50, no subscription | Eligibility/posting/payment RPCs | Verify runtime mode each release | P0 | Completion/Driver work | Completion/payment races | Mode agreement |
| Phase 3 Customer payment | PARTIAL | Installed schema/code; zero Customer attempts | Attempt/event/refund/recon | Live pilot and refund ops | P1 | Fare, dispatch, ledger | Signed LIVE payment E2E | Explicit Pay Online |
| Phase 3 Driver payment | PARTIAL | Driver checkout; one production attempt | Same trusted processor | Reconcile attempt/pilot | P1 | Phase 2 debt | Signed event/debt clearing | Driver online pay |
| Phase 4 cancellation | COMPLETE | Active policy/RPC/UI; zero current natural rows | Assessment/liability/grace | Online collection/refund integration | P1 | Payments/ledger | Natural + race/replay | Active policy |
| Phase 5 MOOVU+ | COMPLETE foundation | Active R99 policy; zero memberships | Membership/credit/referral | Product adoption/policy approval | P2 | Booking/fare/ledger | Purchase/waiver/referral E2E | MOOVU+ gate |
| Phase 6 onboarding | LOCAL ONLY | Local migrations/routes/tests; production absent | Immutable versions/review design | Frozen install, cohort migration, legal gate | P0 | Driver identity/Storage | Disposable authenticated/race/security | Schema then cohorts |
| Phase 7 payouts | PARTIAL | Online payables/manual settlement surfaces | Ledger/payable/bank details | Canonical payout domain/provider | P1 | Phase 3 completion | Duplicate/failure/reconcile E2E | Manual pilot first |
| E1 pickup signals | MISSING | Chat/arrival/push reusable | Events/chat/outbox | Canonical non-financial signal events | P2 | Active trip/notifications | Role/state/idempotency | Feature flag |
| E2 pickup points | MISSING | Maps/search/Admin reusable | Map routing/location | Versioned curated points/snapshot | P2 | Fare/routing | Search/admin/history | Service-area rollout |
| E3 guest access | PARTIAL/LEGACY | Existing share routes/tables | Live location/safe DTO base | Unified roles/permissions/hash/expiry | P1 | Auth/public security | Token abuse/revocation/privacy | Guest gate |
| E4 lost items | MISSING | Support/chat/push reusable | Trip history/events | Case + immutable transitions | P2 | Completed trips/Admin | Auth/state/notification | Support gate |
| E5 Wait & Return | BLOCKED | Stops/wait-fee primitives only | Fare/route/trip core | Trip legs and approved economics | P1 | All trip/payment/finance | Full cross-system races | Pilot allowlist |
| Notifications | PARTIAL | Push + outbox + 168 outbox rows | FCM/web push/deep links | Consolidate intent/worker health | P1 | Every feature | Device + retry/dedupe | Outbox flag |
| Mobile | PARTIAL | Split Customer/Driver configs | Current Capacitor targets | Entitlements/deep links/scanner QA | P1 | Notifications/Phase 6 | Android+iPhone device matrix | Store build gates |

## Non-Negotiable Invariants Carried Forward

Financial: integer cents; balanced and idempotent posting; immutable history; explicit reversals; Driver-collected cash is not MOOVU cash; server-authoritative amounts; no client ledger writes; commission/webhook/payable/payout cannot double-post; provider/internal reconciliation; historical finance survives migration.

Trips: one authoritative trip; experiences extend it; pickup signals are not money/status authority; server OTP; replay-safe start/completion; Driver remains occupied through Wait & Return; guest is read-only and least privilege; Admin overrides are audited; finance derives from authoritative trip events.

## Validation Record

| Command/check | Result | Relevance |
| --- | --- | --- |
| `git status --short`, branch, HEAD | PASS; extensive pre-existing dirty tree identified | Prevents accidental overwrite/release bundling |
| Production Supabase catalog/policy queries | PASS, read-only | Proves Phase 1–5/Phase 3 schema state and Phase 6 absence |
| Ledger invariants | 29 transactions, 58 entries, 0 imbalance, 0 duplicate keys | Current financial integrity snapshot |
| `npm test` | PASS: 234/234 | Current local contract/helper coverage |
| `npx tsc --noEmit` | PASS | Static type safety |
| `npm run lint` | PASS: 0 errors, 3 warnings | Code-quality baseline |
| `npm run build` | PASS: Next.js 16.1.6 compiled, typechecked and generated 200 pages | Production compilation of dirty local tree; not release authority |

No audit failure was “caused by” the audit because the audit changed no runtime code or database state.
