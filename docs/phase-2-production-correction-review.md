# Phase 2 production correction review

Date: 2026-09-11  
Review mode: **READ-ONLY — CORRECTION NOT APPLIED**  
Recommendation: **PASS FOR CONTROLLED OWNER-APPROVED INSTALLATION**

## Repository and artifact

- Repository: `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`
- Branch: `main`
- HEAD: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`
- The existing dirty worktree was preserved. No reset, clean, stash, revert, commit, or push was performed.
- Corrective migration: `docs/phase-2-shadow-payment-cutoff-correction.sql`
- Verified SHA-256: `46d4e019e336da5a7064f8aa7a1dd20f9ce1d2eacddf8b0379e20c209e3be0b0`
- `git diff --check`: PASS; line-ending notices only.

## Production identity and current state

The Supabase dashboard and SQL editor both identified the selected project as production:

- Project name: `moovu-kasi-rides`
- Project ref and URL: `mvazbszenqahgqpznhhq`, `https://mvazbszenqahgqpznhhq.supabase.co`
- Region: West EU (Ireland), `eu-west-1`
- Compute: nano (`t4g.nano` shown on the database card)
- Status: Healthy
- Dashboard latest recorded migration: `phase1_financial_ledger_foundation`

A SELECT-only production query verified:

| State | Current value |
|---|---:|
| Phase 2 database mode | `OFF` |
| Effective cutoff | `NULL` |
| Subscription required | `true` |
| Financial accounts | 0 |
| Financial transactions | 0 |
| Financial ledger entries | 0 |
| Shadow reconciliation rows | 0 |
| Installed Phase 2 base functions | 9 |
| Installed Phase 2 base triggers | 2 |
| Correction-only functions present | 0 of 2 |
| Correction-only triggers present | 0 of 3 |

The existing `phase2_post_verified_driver_payment(uuid,uuid)` is still the original base definition. This proves that the correction has not already been installed. Database mode `OFF`, together with the deployed application's absent `MOOVU_PHASE2_FINANCE_MODE` setting and fail-safe default, means SHADOW and AUTHORITATIVE remain OFF. The 15% commission, R50 enforcement, and subscription removal remain inactive.

## Supabase health and quota

Classification: **SAFE BUT MONITOR**.

The production project is Healthy and served SELECT queries normally. The project is not paused, requests are not currently returning HTTP 402, and the database is not under a platform read-only restriction. The dashboard showed CPU 4%, disk 4%, RAM 53%, and 7/60 database connections.

The organization is on the Free Plan for the 22 August–22 September 2026 billing cycle. The exact warning is:

> Your grace period has started. Your organization went over its quota in the previous billing cycle (Egress Exceeded). You can continue with your projects until your grace period ends on 19 Sep, 2026. After that, the Fair Use Policy will apply. If you plan to maintain this level of usage, upgrade your plan to avoid any restrictions. If restrictions are applied, requests to your projects will return a 402 status code.

Current organization usage was below all displayed limits: egress 2.003/5 GB (40%, 2.997 GB remaining), cached egress 0/5 GB, storage 0.678/1 GB (68%), database summary 0.073/0.5 GB (15%), MAU 146/50,000, Realtime messages 4,266/2,000,000, peak Realtime connections 7/200, and Edge Function invocations 0/500,000. Production database size was 70.05 MB; disposable was 28.5 MB. Usage can take up to one hour to refresh.

The warning is organization-wide and reflects the previous billing cycle, not current production database exhaustion. The correction is small DDL and does not materially affect egress. It is safe to install while the project remains unrestricted, but a future pre-install check must confirm the project is Healthy, below quota, and not returning 402. Installation must not proceed after 19 September if restrictions have started or the warning has escalated.

## Production schema compatibility

The corrective SQL was compared with the live production catalogs. All referenced tables exist: `phase2_finance_policy`, `phase2_shadow_reconciliations`, `financial_accounts`, `financial_transactions`, `financial_ledger_entries`, `driver_payment_requests`, and `profiles`. Every referenced column and type matched; the compatibility query returned an empty missing/incompatible list.

The installed Phase 1 functions match the required signatures and return types:

- `phase1_ensure_financial_account(text,text,text,uuid,text,text) returns financial_accounts`
- `phase1_post_financial_transaction(text,text,text,text,uuid,text,text,uuid,timestamptz,jsonb,jsonb,uuid) returns jsonb`

The installed Phase 2 base functions, two trip snapshot triggers, table RLS, unique operation/idempotency indexes, source/type/state checks, and account-category checks are intact. The live constraints allow `DRIVER_PAYMENT`, `DRIVER_PAYMENT_REQUEST`, `PAYMENT_CLEARING`, `DRIVER_COMMISSION_DEBT`, and `DRIVER_UNAPPLIED_CREDIT`. The correction introduces no enum dependency or RLS policy. It adds two trigger functions and three triggers and replaces the existing payment RPC without changing its `(uuid,uuid) -> jsonb` signature.

## Empty-ledger and historical-payment safety

Installing against 0 accounts, 0 transactions, and 0 entries is safe. The migration contains only prerequisite checks, function definitions, trigger replacement/creation, and privilege statements. It contains no data insert, backfill, opening balance, policy update, or call to a financial posting function. Installation therefore creates no financial account, transaction, ledger entry, debt, credit, shadow row, or legacy-record mutation.

The approved historical commission payment remains present and unchanged:

- Request: `e7e165ee-48e1-407b-afac-bf051f9cd080`
- Driver: `fc1a5b6b-ee52-4f63-8f5e-e17e7fe1d64a`
- Amount expected/submitted: R104.60 / R104.60
- Review time: `2026-09-06 12:53:20.282831+00`

Installation leaves it historical because `effective_from` remains NULL. At a later approved SHADOW activation with a future cutoff, replay compares immutable `reviewed_at` with that cutoff, persists `PRE_CUTOFF_SKIPPED`, and creates no financial transaction, debt reduction, unapplied credit, or eligibility effect. This behavior passed the disposable correction suite.

## Effective cutoff readiness

The migration does not set `effective_from`. The existing policy check permits NULL only while mode is `OFF`; the payment RPC rejects mode `OFF` and separately rejects a missing cutoff. The new guard trigger allows the first server-controlled assignment from NULL and rejects any later change or clearing once non-null. Installation is therefore safe with Phase 2 OFF and cannot activate posting. Setting the future cutoff and changing mode remain separate, owner-approved SHADOW activation actions.

## Function, trigger, and authorization review

There is no live name collision for the two new functions or three new triggers. `CREATE OR REPLACE` intentionally replaces only `phase2_post_verified_driver_payment(uuid,uuid)` and preserves the deployed caller signature. The result remains JSONB and adds explicit `posting_outcome`, `posted`, allocation, cutoff, and replay fields. Every new or changed function fixes `search_path` to `public, pg_temp`.

The cutoff trigger runs only before updates of `effective_from`. The debt-floor triggers run after a financial transaction is inserted or changes state; pending inserts return immediately, and posting updates evaluate affected Driver debt accounts. Neither function writes the triggering table, so no trigger loop or recursion is introduced.

The migration revokes execution from `PUBLIC`, `anon`, `authenticated`, and `service_role` on both trigger functions. It revokes all execution on the payment RPC and grants only `service_role`. The RPC then requires non-null `p_actor_id` and resolves `profiles.role` in the database, allowing only `owner` or `admin`. Missing profiles, NULL actors, unknown roles, Customer, Driver, Dispatcher, and Support remain fail-closed. The intended trusted server route remains usable.

## Concurrency and debt invariant

The advisory lock key is `hashtextextended('driver-finance:' || driver_id, 0)`. It is stable for one Driver, transaction-scoped, and does not serialize unrelated Drivers. Different payments first lock their own request row and then contend on the same per-Driver advisory lock. Same-payment retries serialize on the request row and resolve through the stable `driver_payment:<request_id>` idempotency key. The fixed lock order does not introduce a cross-request lock cycle.

After the lock, posted Phase 2 debt is recalculated. Application is `least(verified payment cents, greatest(posted debt cents, 0))`; the remainder becomes `DRIVER_UNAPPLIED_CREDIT`. The unique idempotency/source indexes prevent duplicate payment transactions. The ledger-level trigger rejects any posting that would leave Driver commission debt below zero, including postings through another path. Eligibility can still clamp display values defensively, but financial correctness no longer depends on that clamp.

## Replay recovery and application compatibility

The route preserves the required sequence: the legacy `phase05b_review_driver_payment` result commits first; when the result is approved and application mode is SHADOW, both a first approval and `replayed=true` recovery call the payment RPC with the same request UUID. The corrected RPC returns an existing transaction before recalculating debt, so a third retry is neutral. Historical replay returns a persisted `PRE_CUTOFF_SKIPPED` decision, ending the failure loop. Driver notification delivery remains suppressed when the legacy result has `replayed=true`.

Production deployment `dpl_G34Qh4vHNeECgevMM1GmA1CYCeso` is READY and contains the Phase 2 base application package, but it predates the correction-specific route refinement. The local `src/app/api/admin/payment-reviews/route.ts` adds the `Phase2PaymentPostingResult` shape and a dedicated resolved log branch for `PRE_CUTOFF_SKIPPED`. Database financial safety does not depend on this logging branch: the deployed route already calls the same RPC for replay recovery and treats a successful JSONB response as resolved. Only the corrective database migration is required for safe installation while Phase 2 remains OFF. The route refinement should be separately reviewed and deployed before SHADOW so operations can distinguish a historical skip from a posted reconciliation.

## Migration transaction safety and rollback

The migration is enclosed by one explicit `BEGIN`/`COMMIT`. PostgreSQL DDL, trigger changes, function replacement, and grants/revokes are transactional. A failed prerequisite, definition, trigger, or privilege statement rolls the entire transaction back, including any preceding `DROP TRIGGER` or `CREATE OR REPLACE`; no partial-install residue is expected. Dependency order is valid, and disposable initial install plus reinstall both passed.

Rollback requires a separately reviewed SQL transaction. While Phase 2 remains OFF and the ledger remains empty, it should:

1. Drop the three correction triggers.
2. Drop `phase2_guard_finance_policy_cutoff()` and `phase2_assert_driver_commission_debt_floor()`.
3. Restore the exact pre-correction `phase2_post_verified_driver_payment(uuid,uuid)` definition and its original revoke/grant contract from the validated base migration.
4. Verify mode/effective cutoff and all ledger/shadow counts are unchanged.

No application rollback is required for the database-only installation. If post-install smoke checks fail, keep application and database modes OFF, do not set a cutoff, capture the error, and execute the reviewed rollback transaction. If the local route refinement is deployed later and must be rolled back, deployment `dpl_G34Qh4vHNeECgevMM1GmA1CYCeso` is the known Ready application rollback target.

## Quiet-window requirement

Use a brief quiet production window because the migration replaces payment-posting behavior and installs transaction triggers. The review found zero active trips, zero pending/shown offers, and zero active payment-review/payment-posting database sessions. Two requests were in `pending_payment_review`; they need not be altered or cleared, but Admins must not approve, reject, or change payment reviews during installation and verification. Avoid simultaneous ledger or finance administration. Keep customer/driver booking available unless a new active-trip condition appears; the DDL does not rewrite trip data.

## Pre-install checklist

- Obtain explicit owner approval for this exact corrective migration only.
- Recompute the exact SHA-256 and require `46d4e019e336da5a7064f8aa7a1dd20f9ce1d2eacddf8b0379e20c209e3be0b0`.
- Visibly select project `moovu-kasi-rides`, ref `mvazbszenqahgqpznhhq`; exclude disposable `tangtlmdpnvmoviwrgvd`.
- Confirm project Healthy, database/API available, no HTTP 402, no pause/read-only restriction, current egress below 5 GB, and grace state has not escalated.
- Confirm database Phase 2 OFF, `effective_from` NULL, application mode OFF, SHADOW OFF, and AUTHORITATIVE OFF.
- Confirm ledger remains at expected `0 / 0 / 0` and shadow rows remain 0, or stop and review any drift.
- Re-run prerequisite table/column/function/constraint checks and confirm the correction is still absent.
- Confirm no payment-review or Phase 2 posting session is active; announce and enforce the payment-review quiet window.
- Confirm the two pending requests are not being actioned and no finance administrator is posting concurrently.
- Keep the rollback SQL ready but do not execute it unless the reviewed rollback gate is met.

## Post-install read-only verification plan

- Recompute/record the executed artifact hash and confirm the SQL transaction completed once.
- Verify exactly two correction helper functions plus the replaced payment RPC and exactly three correction triggers.
- Verify all three functions use fixed `search_path=public, pg_temp`.
- Verify trigger functions have no `PUBLIC`, `anon`, `authenticated`, or `service_role` execution and the payment RPC is executable only by `service_role`.
- Verify the cutoff guard and debt-floor trigger definitions attach to the intended columns/tables.
- Confirm policy mode remains OFF and `effective_from` remains NULL.
- Confirm account/transaction/entry counts remain `0 / 0 / 0` and shadow rows remain 0.
- Confirm the R104.60 payment retains its original `reviewed_at` and has no `driver_payment:<request_id>` transaction or shadow decision.
- Confirm there is no unexpected financial transaction, account, opening balance, debt, or credit.
- Check Supabase/API and application logs for SQL, RPC, 402, 5xx, or contract errors.
- Run public Customer, Driver, and Admin page smoke checks plus unauthenticated protected-route checks. Do not create a trip, approve a payment, send a notification, or manufacture financial activity.

## Regression results

| Check | Result |
|---|---|
| Correction-focused suite | PASS — 5/5 |
| Phase 2 focused suite | PASS — 22/22 |
| Full direct Node suite | PASS — 170/170 |
| TypeScript `npx tsc --noEmit` | PASS |
| ESLint `npx eslint .` | PASS — 0 errors, 3 pre-existing warnings |
| Production build `npm run build` | PASS — 171/171 pages |
| `git diff --check` | PASS — line-ending notices only |
| Scoped credential scan | PASS — no credential values found |

The ESLint warnings remain the two unused variables in `documentation/moovu-product-spec/report-template.mjs` and the unused `adminAccessToken` in `src/app/admin/(protected)/layout.tsx`. Node's module-type warnings are unchanged.

## Blockers and warnings

No schema, ledger, authorization, concurrency, historical-payment, or migration-atomicity blocker was found. Two controlled follow-ups remain:

- Supabase organization egress grace status must be rechecked immediately before installation, especially because restrictions may begin on 19 September 2026.
- The correction-specific route logging refinement is not in the current production deployment and should be separately deployed before SHADOW activation.

Neither item prevents installing the correction while both application and database Phase 2 modes remain OFF, provided the pre-install health/quota and quiet-window checks pass.

## Final safety confirmation

- Production SQL performed in this review was SELECT-only.
- The corrective migration was not executed and remains absent.
- Phase 2, SHADOW, and AUTHORITATIVE remain OFF.
- The 15% commission and R50 enforcement remain inactive.
- Subscription eligibility is unchanged and remains required.
- The production ledger remains `0 / 0 / 0`; shadow rows remain 0.
- No opening balance or historical financial posting was created.
- No deployment or environment/configuration change occurred.
- No billing/plan/quota change occurred.
- No commit or push occurred.
- Yoco and Phase 3 were not started.

## Final recommendation

The exact corrective migration is safe for a controlled, separately approved production installation while Phase 2 remains OFF. Approval for installation must not include SHADOW activation, cutoff assignment, application deployment, AUTHORITATIVE mode, 15%, R50 enforcement, subscription removal, opening balances, Yoco, or Phase 3.

PHASE 2 PRODUCTION CORRECTION REVIEW PASSED

READY FOR OWNER APPROVAL TO APPLY PHASE 2 CORRECTIVE MIGRATION
