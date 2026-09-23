# Phase 2 correction-specific application deployment review

Review date: 11 September 2026 (Africa/Johannesburg)  
Repository: `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`  
Production Supabase: `mvazbszenqahgqpznhhq`  
Current production deployment: `dpl_G34Qh4vHNeECgevMM1GmA1CYCeso`  
Corrective migration SHA-256: `46d4e019e336da5a7064f8aa7a1dd20f9ce1d2eacddf8b0379e20c209e3be0b0`  
Review mode: read-only; no deployment or production SQL was performed.

## Recommendation

The correction-specific application refinement is safe for a later application-only production deployment while Phase 2 remains OFF. The required runtime package contains one file: `src/app/api/admin/payment-reviews/route.ts`. The relevant correction-specific change recognizes the corrected database RPC's persisted `PRE_CUTOFF_SKIPPED` result and records it as an informational, resolved outcome. Eligible payments continue to use the database for allocation and use the stable `driver_payment:<request-id>` source identity for replay recovery.

The organization remains in an egress grace period because it exceeded egress in the previous billing cycle. Current-cycle usage is below all visible limits and production is healthy, so the deployment gate is **SAFE BUT MONITOR**. Perform a fresh health and quota check immediately before any approved deployment.

## Repository state

- Branch: `main`
- HEAD: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`
- Working tree: dirty with substantial existing Phase 0.5, Phase 1, Phase 2, documentation, and unrelated work. It was preserved without reset, clean, stash, or revert.
- `git diff --check`: passed. Git emitted line-ending conversion notices only; it found no whitespace errors.

The diff against HEAD is not the correction deployment boundary because the current production deployment already contains the broader Phase 2 application overlay. The correction-specific runtime delta is the result contract and historical-skip logging branch in the payment-review route.

## Exact file classification

### A. Required for production deployment

- `src/app/api/admin/payment-reviews/route.ts`

This is the only correction-specific runtime file. A deployment must be prepared from a clean snapshot that reproduces the current production application plus this reviewed file, rather than deploying the repository's entire dirty working tree.

### B. Test-only

- `src/lib/reliability/phase2ShadowPaymentCorrection.test.ts`
- `src/lib/reliability/phase2PaymentRecovery.test.ts`
- `src/lib/server/phase2Rpc.test.ts`
- `src/lib/reliability/phase2FinanceContracts.test.ts`

These verify the correction, recovery, RPC boundary, and Phase 2 contracts. They are not production runtime requirements.

### C. Docs-only

- `docs/phase-2-shadow-payment-correction-validation-report.md`
- `docs/phase-2-production-correction-review.md`
- `docs/phase-2-production-correction-execution-report.md`
- `docs/phase-2-shadow-activation-review.md`
- `docs/phase-2-correction-app-deployment-review.md`

### D. Migration or disposable-validation only

- `docs/phase-2-shadow-payment-cutoff-correction.sql`
- `docs/phase-2-shadow-payment-correction-disposable-validation.sql`
- `docs/phase-2-disposable-security-validation.sql`

The exact corrective SQL is already installed in production. It must not be reapplied as part of an application deployment.

### E. Unrelated existing work

Every other modified or untracked path reported by `git status --short` is outside this correction-specific deployment. This includes the other admin/customer/driver routes, UI files, notification/outbox work, Phase 0/0.5/1 artifacts, base Phase 2 artifacts, product documentation, and local `.codex-local-dev.*.log` files. None belongs in the minimal correction package.

## Runtime behavior

### Historical or pre-cutoff approved payment

The installed database function persists a deterministic historical skip and returns `posting_outcome = PRE_CUTOFF_SKIPPED`, `posted = false`, zero applied cents, and zero unapplied cents. It does not reduce debt, create credit, or create a financial posting. A replay returns the persisted result instead of recalculating against current debt.

The local route calls the Phase 2 RPC only in SHADOW mode after the authoritative legacy payment-review RPC succeeds. It recognizes `PRE_CUTOFF_SKIPPED`, writes an informational `state: resolved` log, and does not classify the outcome as an error. It does not run a retry loop. Subsequent operator replays remain database-idempotent. Notifications are sent only when the legacy result is not replayed, so a recovered historical request does not resend a notification or alter its legacy approval state.

### Eligible post-cutoff payment

The route sends only `p_request_id` and the authenticated `p_actor_id` to `phase2_post_verified_driver_payment`. It does not calculate Phase 2 allocation in JavaScript. The corrected database function caps debt allocation at posted debt, places excess in unapplied credit, and persists the result under `driver_payment:<request-id>`. A failed first shadow attempt can be recovered by replaying the already-approved legacy request. Second and third retries use the same source identity; the database returns the existing result and creates no duplicate financial effect. Notification delivery remains suppressed on legacy replays.

## OFF-mode safety and future SHADOW readiness

`phase2Mode()` defaults safely to OFF. With the production setting absent/OFF, the route never invokes the Phase 2 payment-posting RPC. The correction therefore cannot create a historical skip row, ledger entry, credit, opening balance, R50 eligibility enforcement, 15% commission activation, or subscription change while OFF.

For a later separately approved SHADOW activation, legacy payment approval remains authoritative. Historical payments resolve through the persisted skip contract; eligible post-cutoff payments post to shadow; failures remain visible and recoverable; and legacy replay continues to attempt recovery while database idempotency prevents a duplicate effect.

AUTHORITATIVE remains fail-closed before the legacy mutation and is outside this deployment review.

## Authorization

- `requireAdminUser` denies unauthenticated requests.
- `isFinancialAdminRole` admits only Owner/Admin for financial mutation; Dispatcher and Support receive 403.
- The actor UUID comes from `auth.user.id`, never from the request body.
- Missing authentication or actor identity fails before either protected RPC.
- The installed database function independently requires the service-role execution path and validates the actor's Owner/Admin profile.

The application refinement does not bypass either authorization layer.

## Database contract compatibility

The local route matches the installed corrective contract:

- Function: `phase2_post_verified_driver_payment`
- Named arguments: `p_request_id` UUID and `p_actor_id` UUID
- Result fields used by the route: `contract_version`, `posting_outcome`, `posted`, `replayed`, `applied_cents`, and `unapplied_cents`
- Historical result: `PRE_CUTOFF_SKIPPED`, persisted and replayable
- Eligible result: `POSTED`, persisted and replayable
- Contract version: `phase-2-v1`
- Database rejection: surfaced by `callPhase2Rpc` as a closed failure; unavailable and incompatible contracts return 503, business/constraint rejection returns 409, and unexpected database errors return 500.

The route invokes named parameters, so source-code argument ordering is immaterial. The installed production correction verification confirmed the exact three corrected functions and triggers, fixed search paths, and intended grants.

`callPhase2Rpc` validates the object and contract version at runtime, while TypeScript supplies the detailed result shape. If a trusted database function returned the correct contract version with missing or unknown result fields, the route could misclassify it as a generic resolved posting in logs. This cannot create a second posting because the database mutation and idempotency remain authoritative, and the installed function's verified return shape removes the mismatch for this deployment. Treat stricter payload-shape validation as a later defensive improvement, not a correction deployment blocker.

## Logging review

- Historical skip: `console.info`, with request ID, stable source key, replay flags, and resolved state.
- Successful or replayed post: `console.info` with the same bounded operational metadata.
- RPC or transport failure: `console.error` with request ID, source key, replay state, and normalized error code so reconciliation remains visible.
- Logs contain no payment amount, proof URL, note, service-role key, token, credential, or raw secret.
- The route emits one correction outcome log per request. Replays can produce another informational resolved entry when an operator retries, but do not create repeated failure alerts or notifications.

## Environment, mobile, and notifications

No new environment variable is required. The cutoff and `effective_from` state are controlled by the database. The existing Phase 2 mode defaults to OFF when its setting is absent or invalid.

The change is server/API-only. It requires no iOS or Android source change, Capacitor sync, mobile rebuild, Firebase change, or mobile packaging. Existing push behavior is preserved: a notification is sent after a newly committed legacy result only when outbox delivery is not active; replay recovery does not resend it.

## Failure-mode assessment

| Condition | Result and safety |
| --- | --- |
| Database unavailable / RPC timeout / service-role failure | Legacy approval may already be committed; shadow failure is logged as unresolved and can be replayed. No JavaScript fallback performs finance. |
| Malformed RPC result | Missing object or wrong contract version fails closed. A same-version shape error can affect log classification only; the verified DB contract and database idempotency protect financial state. |
| Historical skip | Persisted, zero-effect, informationally resolved, and replayable without a failure loop. |
| `replayed = true` | Shadow recovery is still attempted when eligible; notification is not repeated. |
| Duplicate request / third retry | Stable source and database uniqueness return the existing result; no duplicate finance or debt change. |
| Process crash after legacy commit | A later replay enters shadow recovery with the same request/source identity. |
| Supabase 402 restriction | RPC fails; no client-side financial fallback runs. The failure stays visible and can recover after service restoration. |

No reviewed path creates duplicate finance, fabricated debt allocation, subscription eligibility change, or repeated notification. A successful legacy approval remains a real database result even if the later shadow side effect fails; the route does not report an uncommitted approval as successful.

## Validation results

- Correction-focused Node tests: **5/5 passed**
- Phase 2 focused suite: **22/22 passed**
- Full direct Node suite: **170/170 passed**
- TypeScript (`npx tsc --noEmit`): **passed**
- ESLint (`npx eslint .`): **passed with 0 errors and 3 existing unrelated warnings**
- Production build (`npm run build`): **passed; 171 static pages generated**
- Credential scan: **passed; 128 changed/untracked non-log files scanned, 0 credential candidates**
- `git diff --check`: **passed; line-ending notices only**

The three lint warnings are the two existing unused variables in `documentation/moovu-product-spec/report-template.mjs` and the existing unused `adminAccessToken` in `src/app/admin/(protected)/layout.tsx`.

## Production health and quota

Read-only dashboard inspection found production healthy on West EU (Ireland), nano/t4g.nano compute: CPU 4%, disk 4%, RAM 44%, and database connections 17/60. The last 60 minutes showed 268 requests and 98.9% success; API Gateway, Auth, Realtime, and Storage showed zero errors. The three visible Postgres errors correspond to known rejected SQL-editor verification wrappers documented during correction installation, not application runtime errors. Advisor reported no issues. Vercel inspection confirms deployment `dpl_G34Qh4vHNeECgevMM1GmA1CYCeso` is the current production target and is Ready.

The exact Supabase banner says the organization exceeded its quota in the previous billing cycle and identifies `Egress Exceeded`. The grace period ends on 19 September 2026; if restrictions are applied after that, project requests will return 402. Current billing cycle is 22 August to 22 September 2026. Current organization-wide usage is:

- Egress: 2.003/5 GB (40%), zero current overage
- Cached egress: 0/5 GB
- Storage: 0.679/1 GB (68%), zero overage
- Production database: 70.07 MB; organization database summary 0.073/0.5 GB (15%)
- Realtime messages: 4,266/2,000,000
- Realtime peak connections: 7/200
- Auth monthly active users: 146/50,000
- Edge Function invocations: 0/500,000

No 402 restriction is active now. The warning applies to the organization and its projects, not only MOOVU production. Classification: **SAFE BUT MONITOR**.

## Future deployment plan

1. Recheck Supabase quota, grace-period state, project health, and absence of 402 restrictions.
2. Read-only confirm Phase 2 OFF, SHADOW OFF, AUTHORITATIVE OFF, and `effective_from` NULL.
3. Confirm ledger counts remain 0/0/0 and shadow rows remain zero unless a separately reviewed legitimate change explains otherwise.
4. Construct a clean deployment snapshot from the current known production application plus only `src/app/api/admin/payment-reviews/route.ts` from this review.
5. Re-run the focused suite, full suite, TypeScript, ESLint, build, credential scan, and diff check against that exact snapshot.
6. Deploy only after explicit owner approval and wait for Vercel Ready.
7. Run public health/smoke checks, then an authenticated Owner/Admin payment-review smoke check if a safe non-mutating or controlled fixture is available.
8. Confirm Phase 2 remains OFF and `effective_from` remains NULL.
9. Confirm deployment alone created no ledger or shadow activity.
10. Inspect application and Supabase logs for 402, authorization, RPC-contract, and reconciliation errors.
11. Keep SHADOW disabled pending a separate activation approval.

## Rollback plan

The previous known-good application deployment is `dpl_G34Qh4vHNeECgevMM1GmA1CYCeso`. Rollback is application-only: promote that deployment or redeploy its exact artifact. The production database correction should remain installed because it safely fixes cutoff semantics and remains inert while Phase 2 is OFF.

While Phase 2 remains OFF, reverting the application refinement reintroduces only the prior historical-skip observability distinction; it does not activate finance or alter legacy behavior. If SHADOW were later enabled, the corrected database would still prevent historical financial effects, but the older route would log the successful skip as a generic reconciliation rather than the explicit historical resolution.

## Unrelated admin footer issue

The Admin-subdomain 404s for `/contact`, `/privacy-policy`, and `/terms` are unrelated to the payment-review API refinement and do not block this deployment. They were not changed in this task.

## Final safety confirmation

No deployment, production SQL, production data change, environment change, commit, push, billing change, Yoco work, or Phase 3 work occurred. Production remains recorded as Phase 2 OFF, SHADOW OFF, AUTHORITATIVE OFF, `effective_from` NULL, 15% inactive, R50 inactive, subscriptions unchanged, ledger 0/0/0, zero shadow rows, and no opening balances. This task did not change those states.

## Final verdict

**PHASE 2 CORRECTION-SPECIFIC APPLICATION DEPLOYMENT REVIEW PASSED**

**READY FOR OWNER APPROVAL TO DEPLOY CORRECTION-SPECIFIC APPLICATION CHANGE WITH PHASE 2 OFF**
