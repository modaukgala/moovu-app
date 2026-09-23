# Phase 3 Yoco online payments audit

Audit date: 2026-09-11 (Africa/Johannesburg)  
Repository: `moovu-kasi-rides-redesign`  
Production Supabase: `mvazbszenqahgqpznhhq`  
Production Vercel deployment: `dpl_6pE7H2xHQpCdNyEuiFknGrNCog3i`

## 1. Executive summary

**Audit verdict — OWNER DECISION REQUIRED.** Phase 3 is architecturally feasible through Yoco's hosted Checkout API, but it is not implementation-ready. MOOVU has no Yoco adapter, payment-attempt store, webhook inbox, refund/reconciliation model, Yoco secrets, or server-authoritative online-payment state today. The existing fare can rise after booking through active-trip stops, while the official Checkout API material reviewed exposes an immediate fixed-amount ZAR checkout and refunds; it does not document authorization-only, later/partial capture, incremental authorization, or stored-card charging.

**PROPOSED:** start with a fixed, guaranteed, server-locked upfront fare. Create and confirm payment before dispatch, prohibit changes that increase that fare unless the customer explicitly completes a new checkout, and use partial refunds for approved decreases. Keep Cash / Transfer unchanged. This minimizes unpaid-trip and off-session charging risk, but requires owner, accountant, legal/privacy, refund-authority, and pilot decisions.

Production was inspected read-only. Supabase is `ACTIVE_HEALTHY`; Phase 2 database policy is `SHADOW`, effective `2026-09-11T18:04:00Z`, with 15% observational commission, R40 warning, R50 limit, and subscription required. Its ledger remains empty, so SHADOW activation is verified but natural posting evidence is still incomplete. No production change was made.

## 2. Audit scope and exclusions

**VERIFIED CURRENT:** scope covered repository, booking/fare/completion/payment paths, local Git drift, Vercel deployment metadata and environment-variable names, production schema/aggregates, Phase 1/2 objects, official Yoco Checkout/API material, and official Apple/Google store rules. **Excluded:** merchant dashboard/API calls, credential values, real/test transactions, webhook registration, mutations, implementation, executable SQL, deployment, and legal/tax conclusions.

Risk: documentation cannot prove merchant eligibility, actual Yoco fees, contractual settlement timing, or webhook-product configuration. Recommendation: resolve section 37 decisions and obtain merchant-specific evidence before design approval.

## 3. Evidence classification

| Label | Meaning in this report |
|---|---|
| VERIFIED CURRENT | Directly checked on 2026-09-11 from current repository, Vercel, production Supabase, or current official documentation. |
| LOCAL ONLY | Present in this working tree; not proof of deployment. |
| DEPLOYED ONLY | Verified in deployment metadata/runtime, but not necessarily committed in Git. |
| PRODUCTION DATABASE ONLY | Verified by read-only production introspection/aggregate query. |
| CLAIMED - NOT VERIFIED | Supplied or documented but unavailable for direct confirmation. |
| PROPOSED | Architecture for later separately approved work. |
| OWNER DECISION REQUIRED | Business, accounting, risk, or authority choice Codex must not make. |
| BLOCKED | Missing provider or business evidence prevents a safe implementation decision. |

## 4. Repository and working-tree state

**VERIFIED CURRENT:** branch `main`; local HEAD and remote `origin/HEAD` are both `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`. The remote is `modaukgala/moovu-app`; no credential was exposed. The tree was already materially dirty: 33 tracked modified files plus untracked Phase 0/1/2 reports, SQL validation artifacts, tests, and local logs. `git diff --check` passed with line-ending warnings only. Package inspection shows Next.js 16.1.6, React 19.2.3, Supabase JS 2.98.0, Capacitor 8.3.3, and no Yoco package or code.

Evidence: `package.json`, `next.config.ts`, `middleware.ts`, `capacitor.config.ts`, `capacitor.customer.config.ts`, `capacitor.driver.config.ts`, Git commands. Risk: HEAD alone cannot reproduce the deployed Phase 2 overlay. Recommendation: preserve all existing changes and establish a reviewed source baseline before Phase 3 implementation.

## 5. Local/deployed/production drift matrix

| Surface | Verified state | Drift / implication |
|---|---|---|
| Local Git HEAD | `87dfec6`, same as remote HEAD | Does not contain the uncommitted Phase 1/2 package. |
| Local uncommitted | Extensive Phase 0/1/2 application, docs, SQL, and tests | **LOCAL ONLY** unless separately verified below. |
| Remote Git | `origin/HEAD=87dfec6` | Behind the deployed isolated Phase 2 source package. |
| Claimed deployment | ID resolves, target production, Ready | **VERIFIED CURRENT**. |
| Actual `moovurides.co.za` | Resolves to the same deployment ID | **VERIFIED CURRENT**; deployed content/source hash was not exposed by Vercel inspection. |
| Production database | Phase 1 and Phase 2 objects installed | **PRODUCTION DATABASE ONLY**; database is ahead of Git HEAD. |
| Migration files | Untracked Phase 1/2 migration packages exist locally | Files are evidence of intent, not deployment; object introspection separately confirms much of their result. |
| Prior reports | Numerous untracked reports | Documentation only; not runtime proof. |
| Yoco | No code, tables, env names, deployment, or DB objects found | Phase 3 is design-only. |

**DEPLOYED ONLY:** the current production build was previously made from an isolated source package containing approved Phase 2 changes; it is not represented by remote Git HEAD. Exact build-source equivalence remains **CLAIMED - NOT VERIFIED** because the deployment artifact source manifest was unavailable.

## 6. Verified Phase 1 and Phase 2 state

**PRODUCTION DATABASE ONLY:** `financial_accounts`, `financial_transactions`, and `financial_ledger_entries` exist with RLS and integer-cent entry amounts. Unique constraints cover account code, financial transaction idempotency key, and `(transaction_id, sequence_number)`; a balancing constraint trigger is present. Phase 2 functions include `phase2_current_policy`, `phase2_post_trip_commission`, and `phase2_post_verified_driver_payment`, plus finance guards. Relevant objects are not exposed through permissive client policies in the policy inventory returned.

The policy row is `SHADOW`, effective `2026-09-11T18:04:00Z`, GO and GO XL `1500` basis points, warning `4000` cents, debt limit `5000` cents, subscription required. Counts were accounts 0, transactions 0, ledger entries 0, reconciliations 0. Consequently: SHADOW is configured, AUTHORITATIVE is off, and legacy wallet/commission paths remain authoritative. The 15% and R50 values are observational controls, not proven enforced economics.

**BLOCKED:** zero eligible natural postings means current production does not yet prove end-to-end SHADOW posting, replay, or reconciliation under live activity. Search-path definitions, all function grants, every index, and missing/duplicate posting checks after the cutoff were not fully reproduced in this audit; prior reports are not promoted to current proof. Phase 3 must remain isolated from that evidence.

## 7. Current payment architecture

**VERIFIED CURRENT / LOCAL ONLY code:** customer booking stores `trips.payment_method`; UI currently presents Cash / Transfer and labels cards “Coming soon” in `src/app/account/payment-methods/page.tsx`. `src/app/book/page.tsx` sends the selected method. `src/app/api/customer/book-trip/route.ts` authenticates the customer, recomputes route/fare on the server, creates a trip, and dispatches it. Trip receipt/history read `final_fare ?? fare_amount` and display the method.

Driver-to-MOOVU payments are a separate proof-of-payment workflow: `driver_payment_requests`, Admin review route/page, `driver_subscription_payments`, `driver_settlements`, `driver_wallets`, and `driver_wallet_transactions`. Related UI includes Driver commission payments, subscriptions, earnings, payment receipts, Admin payment reviews, settlements, and subscriptions. Phase 2 shadows eligible legacy effects into `financial_*` tables. Cancellation assessments use `trip_cancellation_fees` and trip cancellation columns. No customer online payment/refund/provider settlement entity or Yoco storage bucket/job exists.

Operationally, “Cash / Transfer” means the customer pays outside a provider-confirmed application flow after the ride; the trip record holds a label, not authoritative proof of customer collection. Driver POP review concerns money the Driver pays MOOVU for commission/subscription, not a customer fare payment.

## 8. Current booking-to-payment flow

**VERIFIED CURRENT:** quote calculations occur in `src/lib/domain/fare.ts` and server route calculation in `src/app/api/customer/book-trip/route.ts`. The server rejects absent route inputs and recomputes route values, reducing client amount manipulation. The trip stores estimate, final fare, fare breakdown, surge label/multiplier, stops, and route metrics. Dispatch follows booking creation without provider payment verification.

Active stops are allowed for assigned/arrived/ongoing trips in `src/app/api/customer/trips/add-stop/route.ts`; route and incremental fare are recalculated and persisted. Completion in `src/lib/trips/completeTripServer.ts` requires an assigned ongoing trip, start OTP, minimum elapsed time, and a locked fare; it supports end OTP or controlled bypass/admin completion. Completion does not depend on customer payment confirmation. Receipt finality currently follows trip fare/status rather than collection.

Risk: an online prepayment can diverge from a mutable final fare. Recommendation: introduce a fare-version snapshot and explicit dispatchability rule; never reuse `trips.payment_method` as payment proof.

## 9. Current financial source-of-truth matrix

| Concern | Current authority | Conflict/risk |
|---|---|---|
| Quote/estimate | Server fare calculation + trip estimate fields | Client also calculates display values; server must remain authoritative. |
| Final fare | `trips.final_fare`/completion path | Can increase through stops. |
| Customer payment success | None for Cash / Transfer | Method label is not collection evidence. |
| Trip completion | Atomic completion RPC/server path | Independent of customer payment. |
| Driver gross/net | Trip commission snapshot and legacy wallet views | Phase 2 ledger is SHADOW only. |
| MOOVU commission | Legacy wallet/transaction paths | Phase 2 15% remains observational. |
| Driver payment to MOOVU | Payment request + Admin approval + settlement/subscription rows | Must remain separate from customer Yoco payment. |
| Ledger | Phase 1 ledger, Phase 2 SHADOW | Empty and non-authoritative. |
| Receipt | Trip record/UI | Does not prove collection. |
| Notification | Existing direct/outbox mechanisms | Delivery cannot create a financial effect. |

## 10. Existing-data reconciliation findings

**PRODUCTION DATABASE ONLY:** 241 trips, 53 legacy driver wallets, 13 legacy wallet transactions, 9 driver payment requests, 7 subscription payments, 1 driver settlement, 6 cancellation fees, and zero rows in all three Phase 1 ledger tables and Phase 2 reconciliation. Schema has duplicate-prevention constraints in the Phase 1 ledger and some operation keys in legacy payment tables.

**BLOCKED:** this audit did not broad-export production data or expose references/PII. Therefore wallet arithmetic, all inconsistent fare combinations, subscription expiry correctness, cancellation-fee collection/distribution, and every eligible post-cutoff trip cannot be certified here. Empty Phase 1 tables prove no ledger effects, not correctness. Before a pilot, run a separately reviewed aggregate reconciliation that reports counts/sums and masked anomaly identifiers only.

## 11. Official Yoco findings with URLs and access dates

All pages below were accessed 2026-09-11.

| Finding | Official source | Verified behavior / uncertainty |
|---|---|---|
| Hosted Checkout | [Checkout API](https://developer.yoco.com/docs/checkout-api) | **VERIFIED CURRENT:** server creates a checkout and redirects to Yoco-hosted payment; confirm by webhook/server evidence. Hosted entry limits MOOVU's card-data scope. |
| Authentication | [Authentication](https://developer.yoco.com/docs/checkout-api/authentication) | Bearer secret keys are server-only; test/live keys differ. Live keys require an approved verified domain. |
| Test/live | [Testing](https://developer.yoco.com/docs/checkout-api/testing) | Test keys and test mode are available; live requires verified business website. Amounts below R2.00/200 cents are rejected; test refunds are unsupported. |
| Create checkout | [Create Checkout](https://developer.yoco.com/api-reference/checkout-api/checkout/create-checkout) | POST `payments.yoco.com/api/checkouts`; amount is integer cents, currency ZAR; response includes checkout ID, redirect URL, payment ID when available, merchant ID and processing mode. Documented checkout statuses: created, started, processing, completed. |
| Idempotency | [Idempotency](https://developer.yoco.com/docs/checkout-api/idempotency) | Optional POST header; UUIDv4 recommended; same key replays first result; keys expire after 24 hours; conflict while processing and payload mismatch errors are documented. MOOVU must retain permanent internal idempotency independently. |
| Payment events | [Payment Notification](https://developer.yoco.com/api-reference/checkout-api/webhook-events/payment-notification) | Checkout webhook documents `payment.succeeded` and `payment.failed`, cents/ZAR, payment ID, mode and status. |
| Webhook handling | [Handling Events](https://developer.yoco.com/docs/api/webhooks/handling-events), [Verification](https://developer.yoco.com/docs/api/webhooks/verifying-events), [Best Practices](https://developer.yoco.com/docs/api/webhooks/best-practices) | Verify the raw body/signature before trust; respond quickly, expect duplicates/out-of-order delivery, persist identity, and retry durably. Documented headers include webhook ID/timestamp/signature and staged retries. **BLOCKED:** the general Yoco API webhook envelope/signature material and Checkout-specific event reference appear to be separate documentation surfaces; exact subscription/product/envelope must be confirmed before code. |
| Refunds | [Refund Checkout](https://developer.yoco.com/api-reference/checkout-api/checkout/refund-checkout), [Refund guide](https://developer.yoco.com/guides/online-payments/refunding-a-payment) | Live checkout refunds can be full or partial; idempotency is supported; accepted/pending is not final, so webhook/reconciliation is required. Test refunds are unsupported. |
| Rate limits | [Rate Limiting](https://developer.yoco.com/docs/api/rate-limiting) | Exact thresholds are unpublished; 429/Retry-After is documented. |
| Payment lookup | [Fetch Payment](https://developer.yoco.com/api-reference/yoco-api/payments/fetch-payment-v-1-payments-payment-id-get) | OAuth-scoped Yoco API can return payment status, checkout ID, fees and refunds. This is a different authorization surface from Checkout secret-key docs and needs merchant/product confirmation. |
| Payouts | [Payouts](https://developer.yoco.com/api-reference/yoco-api/payouts/introduction), [Payout Entries](https://developer.yoco.com/api-reference/yoco-api/payouts/list-payout-entries-v-1-payouts-payout-id-payout-entries-get), [Reconciliation guide](https://developer.yoco.com/guides/online-payments/reconciliation/reconciling-checkout-api-payments-with-daily-payouts) | Payout states and payment/refund/fee/dispute entries are documented. Checkout ID appears as Online Reference in payout exports. A paid payout can later change if returned by the bank. |
| Pricing | [Yoco pricing](https://www.yoco.com/za/pricing/) | Public pricing exists, but the exact applicable online fee, VAT treatment, and merchant contract were not verified. Do not encode a percentage. |
| Capabilities absent from reviewed Checkout docs | Same Checkout reference above | **BLOCKED:** authorization-only, later/partial capture, incremental authorization, checkout amount mutation, tokenized/saved cards, and unattended follow-up charges were not documented. Obtain written Yoco confirmation or choose a documented model. |
| Merchant/disputes | Yoco merchant account and payout material | Verified domain/live keys are prerequisites. Exact reserve, withholding, chargeback workflow and liability remain **OWNER DECISION REQUIRED/BLOCKED** pending merchant terms and Yoco confirmation. |

## 12. Final-fare versus upfront-payment decision matrix

| Option | Protection and risk | Yoco fit / operations | Verdict |
|---|---|---|---|
| A Estimate now; refund/collect difference | Driver protected initially; customer faces refunds/top-ups; failed top-up leaves debt | Refund documented; unattended additional charge not documented; high reconciliation load | Possible only with explicit second checkout; not preferred |
| B Authorize estimate; capture final | Best conceptual fit for mutable fare | Auth/capture/incremental capability not documented | **BLOCKED** |
| C Dispatch; charge after completion | Customer pays exact final fare | High abandonment/unpaid-trip risk; saved/off-session charge not documented | Reject for v1 |
| D Fixed guaranteed upfront | Clear customer consent, protects Driver, low payment ambiguity | Direct fit with fixed checkout; fare-changing operations must be constrained | **PROPOSED preferred v1** |
| E Estimate with adjustment tolerance | Flexible but can surprise customer and create top-up/refund burden | Upward adjustment still needs a new approved payment | Not preferred without strong consent design |
| F Deposit plus final checkout | Limits some loss | Two checkouts, more abandonment and accounting complexity | Defer |

For D, freeze the fare version before checkout, expire it explicitly, make only `SUCCEEDED` payment dispatchable, and disclose that in-trip changes can require a new price and checkout. Downward service adjustments use a separately authorized partial refund. All tolerance, re-consent, and unpaid-completion rules are owner decisions.

## 13. Recommended customer UX

**PROPOSED:** keep “Cash / Transfer” behavior unchanged. For “Pay Online,” show a guaranteed amount, quote expiry, cancellation/refund terms, and “Pay securely with Yoco.” Create an internal attempt, then a hosted checkout. The booking page shows Waiting for payment until a verified server event succeeds; only then create/release dispatch work. Declines, cancellation, expiration, abandonment, or webhook delay remain non-dispatchable with retry/new-attempt and Cash fallback choices.

Return pages show “checking payment” and fetch server state. They never accept success from a query string. Background/termination recovery uses the attempt ID bound to the signed-in customer, then server state. Refund screens distinguish requested, pending, partially refunded, refunded, and failed/reconciliation required.

## 14. Mobile and Capacitor return-flow design

**VERIFIED CURRENT:** customer app ID `za.co.moovu.customer` wraps `https://moovurides.co.za`; Driver app is separate. Android has intent filters and the app already handles `appUrlOpen`; no iOS directory was available in this checkout, so iOS association status is **BLOCKED**.

**PROPOSED:** open Yoco's HTTPS hosted checkout in the system browser/auth session. Use allowlisted HTTPS success/cancel/failure URLs containing only a random attempt locator, then validated Universal Link/App Link association to return. Reject arbitrary return URLs and hosts. On foreground or deep link, reload attempt state from the authenticated server; safely deduplicate multiple returns. Web/PWA uses the same server status page. Never place provider secrets/status/amount authority in the link.

Official policy: [Apple App Review Guideline 3.1.3(e)](https://developer.apple.com/app-store/review/guidelines/) requires non-IAP methods for physical services consumed outside the app. [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en) says Play Billing must not be used for physical services such as transportation. Yoco checkout is therefore policy-compatible in principle; final binaries and disclosures still require store review.

## 15. Authoritative payment-verification design

**PROPOSED:** the authority is a verified Yoco `payment.succeeded` event persisted from the raw request, with optional server-side provider lookup when the merchant API product is confirmed. In one database transaction validate provider event uniqueness; signature; live/test environment; expected merchant; payment and checkout IDs; ZAR; exact cents; internal attempt; customer ownership; booking/trip; fare version; and immutable metadata binding. Then transition the attempt/payment and create one financial effect.

The browser return, client state, query parameters, and customer-submitted status never succeed a payment. Store internal attempt UUID, booking/trip UUID, fare-version hash, provider checkout/payment/event IDs, server-generated checkout idempotency key and payload hash. Metadata is correlation evidence, never sole authority.

## 16. Separate state machines

**PROPOSED:** use independent constrained states:

- Attempt: `CREATED -> PENDING -> SUCCEEDED | FAILED | CANCELLED | EXPIRED`; terminal success cannot revert, and a new retry is a new attempt.
- Provider payment: retain exact external status plus mapped internal `PENDING/SUCCEEDED/FAILED`; never invent Yoco AUTHORIZED.
- Refund: `REQUESTED -> PENDING -> PARTIALLY_REFUNDED | REFUNDED | REFUND_FAILED | RECONCILIATION_REQUIRED`.
- Reconciliation: `OPEN -> MATCHED | RECONCILIATION_REQUIRED -> RESOLVED`.
- Ledger posting: `PENDING -> POSTED | FAILED`; POSTED is reversed by a new transaction, not edited.
- Driver payable: `NOT_ELIGIBLE -> EARNED -> PAYABLE -> PAID | REVERSED`; payout is later-phase state.
- Provider settlement: `EXPECTED -> SENT -> PAID | UNPAID | FAILED -> RECONCILED` using only provider-supported states.
- Notification: `PENDING -> CLAIMED -> SENT | RETRY | DEAD`; never changes money.

Forbidden: success on redirect; paid-to-failed overwrite; editing posted ledger entries; refund exceeding net paid; payable before approved trip/fare/payment gate; notification-triggered finance.

## 17. Proposed additive database model

No executable SQL is provided. **PROPOSED** conceptual entities:

| Entity | Core shape and controls |
|---|---|
| Payment attempt | UUID PK; customer/booking/trip/fare-version FKs; method/provider/environment; amount/currency cents; status; stable idempotency key + payload hash; unique provider checkout ID; timestamps/expiry. Immutable ownership, amount, currency, fare version after checkout. Customer reads own masked row; service role writes. Partial unique rule: at most one financially effective success per booking/fare version. |
| Provider event inbox | UUID PK; provider event ID unique; event type, environment/merchant identity, body hash, signature evidence, received/verified/processed times, state, attempts, redacted error. Raw evidence encrypted/restricted with retention policy. Service-role only. |
| Provider payment | Internal UUID; attempt FK; provider payment ID unique; exact external + mapped status; paid cents/currency; provider timestamps; immutable success evidence. Service role writes; customer sees masked projection. |
| Refund | UUID; payment FK; provider refund ID unique when known; request idempotency unique; cents; reason; actor/approver; state; provider timestamps/errors. Refund totals constrained to paid amount. Owner/Admin policy controls. |
| Reconciliation item | UUID; typed source IDs, expected/actual cents, state, reason, assignee/resolution actor and times. No deletion; audited resolution. |
| Provider settlement/entry | Provider payout/entry IDs unique; gross/refund/fee/net cents; state/timestamps; payment/refund linkage; ingestion batch. Restricted finance roles. |
| Payment audit action | Append-only actor, role, action, reason, target, correlation ID, time; no card/secret data. |

Indexes: attempt ownership/status/expiry, event processing state/time, payment checkout/payment IDs, refund state, open reconciliation, payout date/state. Rollback: feature flag off stops new online attempts; retain immutable evidence and process/refund already accepted money. Schema removal is not a safe operational rollback.

## 18. Cash versus online accounting

**PROPOSED, accountant review required:** Cash/Transfer keeps the Driver collecting passenger funds and creates MOOVU commission receivable under the approved legacy/Phase 2 model. Online makes MOOVU/Yoco collect customer funds and creates processor clearing/cash plus a Driver payable; it must not also debit the Driver for the same commission. Keep estimated fare, final fare, gross collection, customer funds held, Driver share/payable, MOOVU commission revenue, processor fees/VAT, refunds, clearing, settlement, and disputes separate. Use integer cents. Existing legacy money columns are numeric rand amounts; Phase 1 entries are bigint cents, so all boundary conversions require validated half-up rules.

## 19. Proposed journal examples

All entries are conceptual, balanced, and **PROPOSED / accountant and owner approval required**. `F`=final fare, `C`=commission, `D=F-C`, `P`=prepayment, `R`=refund, `Y`=processor fee.

| Event | Debit | Credit |
|---|---|---|
| Cash trip complete | Driver commission receivable `C` | Commission revenue `C` |
| Online payment before trip | Processor clearing `P` | Customer funds liability `P` |
| Online trip completed | Customer funds liability `F` | Driver payable `D`; commission revenue `C` |
| Final lower | Customer funds/refund liability `R` | Customer refund payable `R` (then debit payable, credit clearing/bank on success) |
| Final higher | No journal until second payment succeeds | New collection follows prepayment entry; unpaid difference stays visible, never silently charged |
| Full/partial refund | Refund/customer liability or reversal account | Processor clearing/bank; reverse related revenue/payable when economically required |
| Failed refund | No cash-clearing credit | Keep refund payable and reconciliation-required evidence |
| Cancellation/no-show collected | Customer funds liability | Driver compensation payable + approved MOOVU cancellation revenue |
| Yoco bank settlement | Bank net amount + processor fee/receivable | Processor clearing gross |
| Processing fee | Processor fee expense (+ recoverable VAT only if tax evidence permits) | Processor clearing/payable |
| Chargeback | Dispute/chargeback receivable or expense; reverse payable/revenue per policy | Bank/processor clearing |
| Reversal | Exact inverse entries linked to original | Never edit original transaction |

## 20. Driver payable lifecycle

**PROPOSED:** the Driver earns at valid trip completion after final fare is locked. For online trips, payable arises only when both completion/final fare and authoritative payment success exist and fraud/reconciliation rules allow it. Whichever arrives second triggers an idempotent payable posting. Processor fees do not reduce Driver gross/share unless explicitly approved. Driver payout instruction, cadence, minimum, bank validation, payout settlement/failure, and payout reconciliation belong to a later Driver Payout phase.

## 21. Refund, cancellation and no-show boundaries

**VERIFIED CURRENT:** trips record cancellation actor/type/reason/times and fee splits; `trip_cancellation_fees` records assessment, but current rows do not themselves prove collection or distribution.

**PROPOSED:** before assignment, cancel pending checkout or refund a collected amount under policy. After acceptance/travel/no-show, independently record fee assessed, customer liability, fee collected, Driver compensation authorized/payable/paid, MOOVU revenue, waiver/reversal, and refund state. Driver cancellation normally refunds collected funds unless a documented exception applies. Pending payments cannot fund compensation. Duplicate cancellation events use a stable trip+cancellation-version identity. Phase 3 must store/refund and reconcile; automated cancellation/no-show economics may be deferred until owner policy and tests are approved.

## 22. Yoco fees and settlement reconciliation

**VERIFIED CURRENT official docs:** payout states include sent/paid/unpaid/failed; payout entries can include payment, refund, fee, dispute, adjustment and other types; reconciliation can use Checkout ID/Online Reference. **BLOCKED:** merchant-specific fee rate, VAT evidence, settlement calendar, reserves/holds, and API entitlement are unknown.

**PROPOSED:** reconcile provider checkout/payment/event -> attempt -> booking/trip/fare version -> gross/refund -> fee/VAT -> payout/entry -> net bank deposit -> ledger -> Driver payable. Keep unresolved queues for provider success/MOOVU pending, ledger missing, amount/currency mismatch, duplicate/orphan payment/refund, payout without sources, bank/fee mismatch, and unposted chargeback. Daily payout reconciliation and independent bank matching are required before expanding a pilot.

## 23. Chargeback and dispute handling

**BLOCKED:** payout entry types show disputes, but reviewed official material did not establish the complete notification, evidence deadline, representment, liability, or final-state contract. **PROPOSED:** ingest dispute evidence into a restricted case, freeze only the affected unpaid Driver payable according to an approved policy, post linked reversible accounting, alert Owner/finance, and reconcile the provider/bank result. Never delete the payment or rewrite the original ledger. Owner must decide liability and hold policy.

## 24. Webhook security and durability

**PROPOSED:** HTTPS endpoint reads exact raw bytes, checks timestamp tolerance and signature using the precise Yoco product algorithm, uses constant-time comparison where applicable, validates environment/merchant, then inserts an immutable event keyed by provider event ID/body hash. A short database transaction verifies and records receipt. Return 2xx only after durable capture; processing can retry asynchronously. Signature failure returns failure without persisting sensitive body content.

Workers claim rows transactionally, tolerate duplicates/out-of-order events, apply payment/refund/ledger/payable changes atomically or leave a visible retry/reconciliation state, and store attempt count/last redacted error. Do not use Vercel instance memory. The precise Checkout-vs-general webhook envelope is an implementation blocker to resolve with Yoco before coding.

## 25. Idempotency and concurrency

Use separate stable identities for checkout creation, webhook receipt, provider success, refund request/application, ledger posting, Driver payable, reconciliation, and each notification. Database uniqueness and transactions enforce at-most-once effects; Yoco's 24-hour key retention is insufficient for MOOVU's permanent history.

Duplicate clicks either return the same active attempt or create a controlled new attempt after the old one is terminal. Two workers race on a unique event/payment effect and one replays. Return-page verification only reads/reconciles. Payment success versus cancellation/fare change locks the booking/fare version. Added-stop and completion use optimistic financial versions. Admin refund and refund webhook share a refund identity. Settlement ingestion is repeatable by provider payout/entry ID.

## 26. Failure recovery

**PROPOSED:** timeouts preserve an UNKNOWN/PENDING state and retry with the same key; crashes before durable receipt rely on Yoco retry/reconciliation, and crashes after receipt resume from inbox. Supabase/Yoco/Vercel outages halt dispatch for online attempts while Cash remains available. Lost/delayed webhooks enter scheduled provider reconciliation only if the required read API is confirmed. Ledger/payable failures remain visible and retry idempotently. Mobile closure simply resumes from authenticated server state. No operator may “mark paid” without provider evidence and an audited exceptional procedure.

## 27. Authorization matrix

| Capability | Customer | Driver | Support/dispatcher | Admin | Owner | Service role |
|---|---|---|---|---|---|---|
| Create checkout | Own eligible booking | No | No | No | No | Executes server request |
| View payment/receipt | Own, masked | Trip method/status only | Masked operational status | Masked finance view | Full non-card audit | Full operational row |
| Provider refs | Masked short ref | No | Minimal | Masked/full by duty | Yes | Yes |
| Retry verification | Request status refresh only | No | Escalate | Controlled action | Yes | Executes |
| Request refund | Own request | No | Support request | Within limit | Yes | Executes |
| Approve refund | No | No | No | Below approved threshold | Above threshold/dual approval | Enforces |
| Reconcile/settlement | No | No | Read case only | Finance role | Yes | Executes imports |
| Modify metadata | Never after checkout | No | No | No direct edit | Audited correction entity only | Controlled append |
| Driver payable adjustment | No | No | No | Propose | Approve | Post linked reversal/adjustment |

Tests must cover IDOR and altered booking/customer/trip/amount/currency/metadata, forged/replayed webhook, cross-customer access, open redirect, refund privilege, Driver payment-data isolation, support mutation denial, rate abuse, and secret/log leakage. All privileged mutations require authenticated server roles; browser Supabase writes are forbidden.

## 28. Admin operations

**PROPOSED:** one timeline should show masked customer, booking/trip, estimate/final fare, attempt/provider state, collected/refunded cents, reconciliation, payout, Driver payable, ledger posting, failures/dispute, and masked references. Actions require server authorization, stable idempotency, actor, role, reason, time, and immutable audit record. No browser direct writes. Owner must choose refund thresholds and whether higher-value refunds/adjustments require two people.

## 29. Customer receipts

Cash receipt means finalized trip fare and declared Cash/Transfer method; it must not claim provider-confirmed collection. Online receipt becomes final only after trip/fare finalization and authoritative success, with paid/pending/partially-refunded/refunded/disputed variants. Show booking/trip, final fare, method, payment date, masked provider reference and refund status; never card data, secret IDs, signatures, or internal fraud notes. Merchant-of-record, legal entity, VAT/tax invoice wording and numbering are owner/accountant/legal decisions.

## 30. PCI, privacy and retention

Hosted Yoco checkout should handle card entry; MOOVU stores internal/provider identifiers, cents/ZAR, lifecycle timestamps, masked descriptors only if returned and needed, signature verification evidence, audit actors, and redacted errors. Never store PAN, CVV, full cardholder payload, keys, webhook secret, or raw Authorization headers. Keep secrets only in server secret storage; redact logs and metadata.

POPIA purpose limitation, access controls, privacy notice, operator agreement, cross-border processing, breach process, retention periods, and data-subject rights require legal review. Account deletion must preserve restricted financial/tax/dispute evidence for an approved period, then anonymize/delete where lawful. Exact periods are **OWNER DECISION REQUIRED**.

## 31. Environment and secret design

**VERIFIED CURRENT:** Vercel production has no Yoco-named environment variables. **PROPOSED names:** `YOCO_SECRET_KEY`, `YOCO_WEBHOOK_SECRET`, `YOCO_PROCESSING_MODE`, optional confirmed `YOCO_API_BASE_URL`, expected merchant identity, and a server-side allowed return-origin list. No `NEXT_PUBLIC_` Yoco secret is needed. Separate test credentials/webhooks for local, preview/staging and live production; never mix data. Rotate keys and webhook secrets with overlap procedures supported by Yoco. Supabase service role remains server-only. Configure verified HTTPS domains and signed app/web associations separately after approval.

## 32. Observability and runbook

Emit structured events with correlation/attempt/checkout/payment/event/refund/payout IDs in masked form: checkout requested/result, webhook received/invalid/duplicate/processed, payment/refund transitions, reconciliation/ledger/payable/settlement failures, dispute. Alert on invalid-signature spikes, aged pending payments, succeeded-without-ledger/payable, retry exhaustion, refund aging, payout/bank mismatch and provider outage. Dashboards show counts/amounts by state/environment without PII.

Runbook: stop new online attempts with kill switch; keep Cash available; inspect immutable event and provider dashboard/API; retry the same durable operation; reconcile amount/currency/environment/ownership; use linked reversal/adjustment with approval; document resolution. Never manually insert duplicate success or edit a posted ledger row.

## 33. Sandbox and test strategy

Use Yoco test mode and a disposable Supabase project. Fixtures cover customers/roles, fare versions, cash and online trips, cancellation/no-show, completion, ledger accounts, payouts and mocked signed webhook envelopes. Validate successful/declined/abandoned/expired/invalid/mismatched checkout; duplicates; delayed/out-of-order/forged/body-mutated webhook; concurrency/crashes/outages/timeouts; full/partial/failed refund (provider test refunds require a deterministic adapter simulation because Yoco says test refunds are unsupported); fare lower/higher; stops; Driver payable; balancing; settlement/chargeback simulations; role abuse; receipts; Cash regression; Android/iOS link/background/termination recovery.

Cleanup is disposable-project-only and documented. Expected invariants are section 34. Production real-money testing is forbidden until a separately approved allowlisted pilot.

## 34. Financial invariants

1. One provider payment creates at most one success, ledger, receipt-finalization and Driver-payable effect.
2. One refund identity creates at most one refund effect; cumulative refunds never exceed paid cents.
3. Every posted transaction balances; posted rows are immutable and reversed by links.
4. All new financial amounts use integer cents and ZAR is verified.
5. External and mapped internal states remain separate.
6. Online booking is not dispatchable before authoritative success unless owner explicitly adopts another tested model.
7. Driver payable is unique and cannot arise before completion, final fare, and payment gates.
8. Cash commission receivable and online Driver payable do not double-charge the Driver.
9. Processor fees do not reduce Driver economics without explicit policy.
10. Gross collection is a clearing/liability flow, not automatically MOOVU revenue.
11. Fare versions and adjustments remain traceable with source/reason/actor.
12. Stable retries are safe; notifications have no financial authority.
13. Every mismatch remains visible until audited resolution.

## 35. Phase 2 isolation

Phase 3 feature flag defaults OFF and uses distinct entities, source types, idempotency namespaces and test/production environments. Do not change Phase 2 mode/effective date/commission/subscription behavior or make its ledger authoritative. Sandbox Yoco events never enter production. Exactly-once keys remain separate for legacy effects, Phase 2 SHADOW postings, Yoco customer payment, Driver payable, refund and notification. Online accounting must be shadowed/reconciled before any authority switch, and Phase 2's empty live ledger cannot be treated as completed evidence.

## 36. Risks and blockers

- **BLOCKED:** no decision on fixed/upfront versus mutable fare economics.
- **BLOCKED:** no verified Yoco merchant/live-key/domain readiness, merchant ID, product/API entitlements or contract.
- **BLOCKED:** authorization/capture/incremental/saved-card capabilities are not documented in the reviewed Checkout API.
- **BLOCKED:** exact Checkout webhook subscription/envelope/signature pairing must be confirmed.
- **BLOCKED:** exact online fees, VAT, payout timing, reserve/hold and chargeback terms are unknown.
- **BLOCKED:** production source is ahead of remote Git and Phase 2 live SHADOW evidence is incomplete.
- **BLOCKED:** iOS project/association evidence is absent from this checkout.
- **OWNER DECISION REQUIRED:** merchant/tax/refund/payable/pilot policies and operational staffing.

## 37. Owner decisions required

Decide and document: merchant of record; payment timing/model; guaranteed-fare scope; upward/downward tolerance; rand/percentage threshold; customer re-consent; higher/lower final-fare outcome; failed top-up; whether unpaid online trips dispatch or complete; fee/VAT absorber; commission basis; Driver earning/payable timing; refund request/approval and dual-control thresholds; cancellation/no-show collection and compensation; chargeback liability/holds; payout frequency/minimum/settlement hold; tax/VAT invoice treatment; customer wording; retention; pilot users/service area/amount/daily limits; support hours and kill-switch owner.

## 38. Proposed implementation sequence

| Stage | Scope / dependencies | Acceptance, rollback, gate |
|---|---|---|
| A | Merchant evidence, provider clarification, owner/accountant/legal decisions, source baseline | Signed decision record; no code. Owner gate. |
| B | Additive attempt/event/payment/refund/reconciliation schema | Disposable security/concurrency/invariant tests; rollback by flag, retain evidence. Migration review gate. |
| C | Server-only Yoco adapter and checkout creation | Test keys, cents/ZAR/ownership/idempotency tests; adapter flag off. Code review gate. |
| D | Verified durable webhook inbox/processor | Official signature fixtures, replay/out-of-order/crash tests. Security gate. |
| E | Customer UX and web/Android/iOS return recovery | Device and accessibility tests; Cash unchanged. Mobile review gate. |
| F | Shadow ledger and Driver payable | Balanced, duplicate-safe, reconciled; never authoritative. Accountant/Phase 2 isolation gate. |
| G | Refunds, reconciliation, Admin timeline | Authority/audit/failed-refund/payout tests. Owner operations gate. |
| H | Disposable Yoco test-mode validation | Full section 33 suite and cleanup report. Validation gate. |
| I | Controlled staging | Separate credentials/webhook/domain and device tests. Deployment approval gate. |
| J | Allowlisted production pilot | Explicit migration, env, deployment and pilot approvals; kill switch/reconciliation ready. Separate production gate. |

## 39. Production pilot design

**PROPOSED:** flag OFF globally; allowlisted owner/test customers; fixed guaranteed fares only; single service area and ride type; minimum R2 and conservative per-transaction/daily volume caps; Cash fallback; no active-trip price-increasing changes; owner-controlled kill switch. Reconcile every payment/refund/ledger/payable and first payout to bank before expansion. Staff a support/refund procedure and stop automatically on mismatches, aged states, invalid signatures or provider outage. Expansion requires a new evidence review, never test-passing auto-release.

## 40. Exact next safe step

Owner, accountant, and security lead review sections 11–12, 18–24, 30, 36–39 and produce a signed decision record. In parallel, obtain written Yoco confirmation for the merchant/product webhook contract, auth/capture/saved-card limitations, refund testing, fee/VAT, payout and dispute terms; verify live-domain eligibility without exposing keys. Then perform a separate read-only implementation-readiness review against a clean, reproducible source baseline. Do not write code or SQL until those gates pass.

---

Audit validation: this report contains no credential values and no executable SQL. Only this report was created. All production queries were read-only introspection/aggregates; no Yoco request, webhook registration, environment change, deployment, commit, push, or Phase 2 change occurred.

PHASE 3 YOCO ONLINE PAYMENTS AUDIT COMPLETE -  
OWNER BUSINESS, ACCOUNTING, SECURITY, AND ROLLOUT DECISIONS REQUIRED
