# Phase 3 authenticated fake-provider application E2E

## Connected disposable gate, 2026-09-12

**Verdict: PASSED for the connected authenticated disposable application E2E.** This section supersedes the earlier blocked snapshots below, which remain as history. This is not a Yoco integration or production deployment approval.

The private runner used the exact guarded disposable project `tangtlmdpnvmoviwrgvd` and synthetic Supabase Auth identities. It called the real server customer checkout, trusted-event processor, `dispatchTrip`, offer acceptance, Driver arrive/start/completion routes, and `completeTripServer`. External notification delivery was suppressed in the test loader; the payment, authorization, dispatch, and lifecycle paths were not replaced. Both trips respected the real minimum-time window.

| Connected assertion | Verified result |
| --- | --- |
| Customer and fare | Authenticated customer ownership enforced; missing and wrong-customer calls rejected; locked R100 fare came from server state. |
| Payment and gate | Fake provider initiated only under test mode. Pending and failed payment attempts were denied by actual `dispatchTrip`. A trusted failed event followed by a verified success retry allowed dispatch; duplicate verified event did not duplicate payment or pre-service ledger posting. Customer direct payment-state mutation was denied. |
| Online lifecycle | An authenticated Driver without the offer was rejected. The offered Driver then accepted, arrived, started and completed through application code. The service-only payable RPC required verified payment, POSTED payment ledger, legitimate completed trip and matching legacy commission. A R100 fare yielded one R10 legacy commission and one R90 earned Driver payable. Duplicate completion did not duplicate it. |
| Completion accounting | The payable RPC now atomically links one balanced three-entry Phase 1 reclassification: debit customer unapplied-funds liability R100, credit Driver earnings payable R90, credit commission revenue R10. Stable `online_service_completion:<trip_id>` prevents replay duplication. This is after legitimate service completion; payment success alone creates no Driver earnings. Provider fees and processor settlement remain outside this test. |
| Cash regression | A separate Cash trip traversed actual dispatch, acceptance, arrival, start and completion; it created no Phase 3 payment attempt or online Driver payable. |
| Disposable isolation | The accepted foundation SHA-256 remained `06ad838b67c974b1f53531c9b4d8b1169818fc5dc66e166c1737a17e011e2c25`. Disposable-only fixture shape and existing dispatch RPC migrations were installed to align the older disposable schema. The updated completion-payable RPC and rollback-only accounting contract test were installed/run on disposable only. |
| Cleanup | Fixed-ID SQL cleanup succeeded, then 4 synthetic Auth users were deleted. Independent read-only counts found 0 named Auth users, customers, Drivers, trips, attempts, payables and completion reclassification transactions. |

The connected runner returned `ok=true`, `wrongDriverRejected=true`, `payableCents=9000`, `legacyCommissionCents=1000`, `payableLedgerLinked=true`, and both online/Cash offers and completions true. The `P0001` diagnostic was the expected disposable Phase 2 SHADOW posting rejection because its database policy remains OFF; legacy completion and Phase 3 payable succeeded. This test therefore does not prove a production SHADOW accounting interaction. In particular, the new Phase 1 commission credit and observational Phase 2 SHADOW commission posting require a separate reconciliation review before production migration review.

Production `mvazbszenqahgqpznhhq` received no SQL write, configuration change or deployment. Pay Online remains OFF. This gate did not verify live Yoco signatures, provider webhook identity/replay, processor clearing or fee settlement. The completion accounting artifact is a disposable-tested proposal, not approved production SQL. No commit or push occurred.

Validation after the connected run: `npm test` 194/194 passed; disposable environment guard tests 2/2 passed; `npx tsc --noEmit` passed; `npm run build` passed; `git diff --check` passed. Targeted secret scan found no embedded credential; the sole match was the runner's error-redaction expression. `.env.phase3-e2e.local` is ignored by Git. ESLint's first run found one new loader variable-name rule violation; the variable was renamed without changing loader behavior, and lint was rerun. The only other lint findings were three pre-existing unused-variable warnings.

## Current gate: boundary completion, 2026-09-12

**Verdict: BLOCKED.** Local application seams and a disposable payable RPC were added, but the connected authenticated application flow was not run. The prior-gate snapshot below is retained as history; its statements that the caller and payable seam do not exist are superseded by this section.

Repository: branch `main`, starting HEAD `87dfec6`, pre-existing dirty tree preserved. Accepted foundation SHA-256 recomputed after changes: `06ad838b67c974b1f53531c9b4d8b1169818fc5dc66e166c1737a17e011e2c25`. The foundation was not changed or reapplied. No commit, push, deploy, Yoco call, production SQL write, or production configuration change.

| Required boundary | Result |
| --- | --- |
| Disposable-only runtime | `scripts/phase3-disposable-env-guard.mjs` requires three explicit `PHASE3_E2E_*` values and an exact `tangtlmdpnvmoviwrgvd.supabase.co` URL, rejecting production `mvazbszenqahgqpznhhq`. Its guard tests pass. A full authenticated server runner and disposable service/auth credentials are still unavailable; `.env.local` points to production and was not used for any E2E write. |
| Customer auth and initiation | New `server-only` internal `initiateAuthenticatedOnlineCheckout` calls the existing `getAuthenticatedCustomer` bearer/JWT/profile helper, rejects inactive accounts, then calls `beginOnlinePayment` with the concrete Supabase store. Local tests show missing auth and wrong-customer rejection, server-fare checkout, and fake-provider rejection under production `NODE_ENV`. These tests mock the auth/store boundary; they are **not** a disposable authenticated HTTP result. No public route was added. Normal online booking remains flag-blocked. |
| Trusted event | Prior disposable trusted-event/ledger and concurrency results remain valid. No newly connected event from this caller was processed. No SQL payment-state shortcut was used as E2E proof. |
| `dispatchTrip` | Real function's payment gate remains before candidate selection. It was **not called** in a connected disposable scenario, either pending or succeeded. |
| Driver acceptance and lifecycle | Existing bearer-authenticated offer response and start/completion routes were inspected. No real disposable offer response, arrive/start, or completion path was run. |
| Completion payable seam | `completeTripServer` now calls a new service-role-only `phase3_post_completed_online_driver_payable` after successful legacy completion for online trips. A completed-trip retry verifies the legacy completion event and retries the payable hook; Cash/Transfer never calls it. If the hook fails, the online completion response reports reconciliation and a retry can recover. The RPC was installed **only on disposable**. |
| Payable economics and atomicity | The RPC derives gross, commission, and Driver net from the legacy-authoritative completed trip and requires its completion business event and matching legacy wallet commission transaction. It requires the verified payment, a POSTED online-payment ledger transaction, and exact locked fare. It records `EARNED` using the current legacy net, never the observational Phase 2 15% and never a provider-fee deduction. `online_driver_payables.trip_id` and its stable idempotency key prevent duplicate rows. Completion and payable are **eventually consistent**, not one database transaction; a completed-trip retry is the recovery path. No new Phase 1 ledger reclassification was posted, because Phase 2 SHADOW already posts a terminal completion transaction and duplicate commission/revenue accounting needs a separate review. `ledger_transaction_id` remains null. |
| Disposable database validation | Project verified `ACTIVE_HEALTHY`. Rollback-only contract test created synthetic payment/completion evidence, rejected premature payable, called the new RPC twice, and asserted one 9,000-cent legacy-net payable from a 10,000-cent fare and 1,000-cent legacy commission. This test uses SQL fixture state setup and **does not prove application E2E**. After rollback: 0 Phase 3 attempts, events, payables, reconciliation rows and 0 named synthetic fixture rows. The RPC is installed; anon/authenticated execute grants are false and service-role execute is true. |
| Cash/Transfer and failure matrix | Existing local regression suite passed, but no connected Cash/Transfer dispatch-to-completion trip or requested authenticated security matrix was executed against disposable. No claim of that gate passing. |
| Feature flag and backdoors | `MOOVU_ONLINE_PAYMENTS_ENABLED` remains false for normal execution; fake checkout is allowed only in the internal caller when `NODE_ENV=test`. No fake-success route, browser override, Yoco implementation, or fake webhook was added. Dangerous-pattern scan found only the expected server-side service-role environment mapping and SQL grant/check. Targeted credential scan found no embedded keys. |
| Application Phase 2 | Source `phase2Mode()` is fail-closed to OFF unless its env value is SHADOW or AUTHORITATIVE; `completeTripServer` invokes SHADOW posting after legacy completion. A read-only Vercel Production environment listing independently confirmed `MOOVU_PHASE2_FINANCE_MODE` is present, but its encrypted value was **not** exposed or verified in this gate. The prior live report records SHADOW. Therefore current application-side SHADOW value is not independently proven here. |
| Production Phase 2 and Phase 3 | Read-only production query confirmed DB `SHADOW`, AUTHORITATIVE off, cutoff `2026-09-11 18:04:00 UTC`, 1500 observational basis points, warning 4000 cents, limit 5000 cents, no Phase 3 schema, no trusted processor, and no payable RPC. Production was never a mutable target. Disposable DB Phase 2 policy is `OFF`. |

Validation: `npm test` **194 passed**, 0 failed, including local online completion-replay and unauthorized-repair tests; disposable guard tests **2 passed**; TypeScript and production build passed after a test import fix; ESLint had 0 errors and 3 pre-existing warnings; `git diff --check` passed with line-ending notices. No authenticated E2E, real dispatch/acceptance/lifecycle/completion, or connected Cash/Transfer test ran. The new SQL artifact is disposable-only until reviewed for production.

**Exact remaining gate:** supply disposable-only auth/service credentials through a secure local test environment, build a runner that invokes the real customer and Driver server paths with external sends suppressed, and execute/clean one connected online and one Cash/Transfer scenario. Review the payable RPC's accounting treatment before any production proposal. Yoco signature headers, signed-content construction, secret encoding, event identity/replay rules and an official signed fixture still need provider confirmation. Pay Online remains OFF and deployment readiness is **not ready**.

## Prior gate snapshot (retained for audit history)

Date: 2026-09-12  
Verdict: **BLOCKED — a connected authenticated disposable application E2E has not run.**

## Repository and accepted boundary

- Repository: `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`; branch `main`; starting HEAD `87dfec6`. The large pre-existing dirty tree was preserved. No commit, push, or deployment.
- Accepted migration: `docs/phase-3-yoco-provider-independent-foundation.sql`; SHA-256 `06ad838b67c974b1f53531c9b4d8b1169818fc5dc66e166c1737a17e011e2c25` (recomputed and matched). It was neither edited nor reapplied.
- Disposable target `tangtlmdpnvmoviwrgvd` was verified `ACTIVE_HEALTHY` before any proposed fixture work. Its Phase 3 schema and trusted processor are present. Read-only counts: 0 attempts, 0 events, 0 payables, 0 reconciliation items. No new fixture was created in this gate, so no cleanup was needed.
- The local `.env.local` Supabase URL resolves to **production** `mvazbszenqahgqpznhhq`. This gate did not run the server or issue application writes using those credentials. There is no verified disposable service-role/auth runtime configuration in this checkout. Secret values were not printed.

## Application paths and current proof

| Boundary | Current finding |
| --- | --- |
| Authenticated customer booking and payment initiation | `beginOnlinePayment` checks the supplied customer ID against the server-read trip, derives a server fare, creates an attempt, and calls an injected provider. `createSupabasePaymentStore` exists, but no authenticated customer route/action calls it. `src/app/api/customer/book-trip/route.ts` rejects online payment while the flag is off. No authenticated disposable customer flow was executed. |
| Fake checkout | `FAKE_TEST` is implemented inside `serverWorkflow.test.ts` only. No public fake-success endpoint or production provider request was introduced. The local unit contract passed in the previous gate; the concrete disposable store was not exercised from an authenticated application path here. |
| Trusted event | `phase3_process_trusted_payment_event` is installed on disposable and was transaction/concurrency-tested in the previous gate. No new authenticated server event-to-dispatch chain was run here. Its caller assumes event authentication; Yoco webhook verification is absent. |
| Actual dispatch | `dispatchTrip` checks the newest online attempt's `state` and `verified_at` through `onlinePaymentDispatchGate`, before offer cleanup/candidate selection. The foundation also guards offer insertion and trip assignment. The actual `dispatchTrip` function was not invoked against disposable in this gate; prior direct-SQL offer/assignment evidence does not substitute for it. |
| Offer and acceptance | `respondToOffer` calls the existing `accept_trip_offer` RPC. No connected disposable invocation occurred. |
| Normal lifecycle and completion | `completeTripServer` validates assignment, active state, start OTP, end OTP or bypass, elapsed time, locked fare, and calls `phase05b_complete_trip`; SHADOW posting follows legacy completion. It was not invoked against disposable here. Prior SQL status changes do not prove this boundary. |
| Driver payable | The foundation trigger permits a payable only after verified success and completed matching trip. It does **not** create one. The application currently only reads `online_driver_payables`; there is no payable creation/eligibility write in `completeTripServer` or another production application path. Consequently the requested payable-seam result cannot be demonstrated by a real completion today. No future commission amount should be invented to fill this gap. |
| Receipt/Admin read model | `onlineReceiptView` and `readAdminOnlinePaymentSnapshot` exist, but no connected authenticated disposable receipt/Admin read was run. |

The connected happy path, Cash/Transfer dispatch and completion regression, pending/failed dispatch denial through actual `dispatchTrip`, duplicate completion, and concurrent duplicate event **did not pass this gate** because the required authenticated application harness was not safely runnable against disposable. Previous isolated local and disposable-SQL results remain described in `docs/phase-3-fake-provider-server-workflow.md`; they are not relabelled E2E.

## Authentication and security

No synthetic auth users were created. Customer ownership, wrong-customer rejection, customer/Driver inability to forge success or `verified_at`, and service-role containment still require authenticated disposable tests. The normal online feature flag is fail-closed (`MOOVU_ONLINE_PAYMENTS_ENABLED` is true only for the literal `true` value); the customer booking route rejects online while disabled. `FAKE_TEST` occurs in the provider type and test module, with no publicly callable fake control found. Source inspection found no `fake-success`, `test-payment`, `force-paid`, `skip-payment`, `bypass-payment`, or `verified=true` route. This is source evidence, not an authenticated penetration result. No external notification, maps, Yoco, or payment request was sent.

## SQL classification and financial isolation

- `docs/phase-3-fake-provider-integration.sql`: **TEST/DISPOSABLE ONLY**. It seeds synthetic fixtures and exercises SQL business rules in a rollback transaction; it cannot certify application dispatch/acceptance/completion.
- `docs/phase-3-trusted-event-processor.sql`: **REQUIRED PRODUCT CAPABILITY, CURRENT ARTIFACT DISPOSABLE ONLY**. An atomic trusted-event processor is necessary for a future provider integration. This particular SQL still admits `FAKE_TEST`, has no authenticated Yoco ingress, and has not had production correction review. Do not promote or apply it as-is.
- The accepted foundation migration remains immutable. No Phase 3 production schema or event processing is installed.

The earlier disposable SQL proof posted balanced pre-service customer funds and payment clearing, with no Driver earnings from payment success; those results were not repeated here. The Phase 2 future 15% remains observational. No subscription, warning/limit, or legacy finance operation was changed.

## Validation performed in this gate

- Full local suite: **188 passed, 0 failed**, including existing payment, dispatch policy, completion contract and recovery tests. These are not the requested connected authenticated disposable E2E.
- TypeScript `npx tsc --noEmit`: passed after the production build. An overlapping first run saw a transient missing generated `.next/types/validator.ts` while `next build` was regenerating `.next`; the sequential rerun passed.
- ESLint: 0 errors, 3 warnings in pre-existing files. Production build: passed. `git diff --check`: passed (line-ending notices only).
- Targeted source/secret scan across the Phase 3 payment library and this report found no hard-coded Supabase secret, Yoco secret, or webhook secret pattern. The broader security review above remains source-level only.
- Authenticated Phase 3 integration, disposable application integration, real dispatch/offer/lifecycle/completion tests: **not run**. This is the gate blocker, not a pass hidden by the successful local checks.

## Phase 2 and production isolation

Read-only production query confirmed `mode=SHADOW`, `effective_from=2026-09-11 18:04:00 UTC`, `go_basis_points=1500`, warning 4000 cents, limit 5000 cents, no Phase 3 attempts table, and no trusted-event processor. Application SHADOW is supported by the prior deployment/observation reports, not independently checked against a live running application in this gate. AUTHORITATIVE remains OFF by the verified database mode. The disposable policy currently reports `OFF`, so it cannot itself prove the requested SHADOW-completion interaction without a separately scoped disposable setup. Production received no SQL write or configuration change.

## Blockers and next safe gate

1. Provide a disposable-only server/auth execution configuration, isolated from the production `.env.local`, then implement a test-only harness that authenticates synthetic customer and Driver identities and invokes the real server workflow, `dispatchTrip`, `respondToOffer`, lifecycle, and `completeTripServer` with external sends mocked. Run it with an explicit project-ref guard and clean all synthetic records.
2. Define and implement the narrow post-completion Phase 3 payable eligibility seam using the existing completion result and immutable verified attempt, with idempotent accounting and no speculative 15% economics. Validate it in disposable before claiming the connected payable outcome.
3. Keep Pay Online off. Separately obtain authoritative Yoco Checkout webhook signature/headers, signed payload, secret encoding, event identity and replay rules, plus an official signed fixture. Do not implement speculative verification or real Yoco calls.

**Deployment readiness: not ready.** No production migration, payment activation, deployment, commit, or push is authorized by this report.
