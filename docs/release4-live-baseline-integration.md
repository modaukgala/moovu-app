# Release 4 live-baseline integration — 21 October 2026

**Decision: integrated for controlled dormant-deployment review, not financial activation.** No production deployment, SQL, configuration, payment, or data change occurred.

## Live source evidence

- All three live domains were previously verified on READY deployment `dpl_Ei4EnnbPGGgaWdKAojC9NJjydFg7` in Vercel project `prj_up795H2nXqHcwVNc0rbgwDaslLKf`. The deployment remains READY in this review.
- The full read-only Vercel deployment API record, unlike the abbreviated `vercel inspect` output, records `meta.gitCommitSha=606c8106c074866c3380348d520e5c2aaf5b0aa0`, branch `codex/moovu-sustained-performance-20261020`, and CLI source. This metadata alone is not treated as source proof.
- Vercel's uploaded `src` file inventory contains 1,390 files. Every one of the 1,388 tracked files present in that inventory has the same raw SHA-1 as the clean local checkout of `606c8106`; there are **zero content mismatches**. The eight tracked `.gitignore` files were excluded from upload. The two extra files are generated `next-env.d.ts` and `tsconfig.tsbuildinfo`. This independently ties the uploaded application source to the Git tree. It does not prove that Vercel's compiled output is reproducible byte-for-byte or that runtime environment values are identical to a local build.
- GitHub `main` currently points to older `be20fb47424731e666af5698f283eaf8c4b1c5d2`; the performance branch is not published as a GitHub branch. Neither was substituted for the deployed source. The local SHA plus deployment source-file hashes form the baseline evidence.

## Integration

The new isolated worktree/branch `codex/release4-live-integrated` starts at verified live source `606c8106`. Release 4 preflight `fd926453347d5a3f7032fd0b0a27e82fb31cd541` descends from the older common parent `a7f5b9b880cbc47e7ef42e91c62eb5133116a2d9`. Its 46 changed files were merged onto the live source with no textual conflict; the shared `src/app/book/page.tsx` was inspected rather than replaced with the older branch version. No application file from the live performance series was removed. The 19-file live performance change set remains in the resulting tree; the only overlapping file is booking UI, which retains live loading/recovery changes alongside Release 4 quote handling.

The older Release 4 branch lacked the live bounded Driver profile loading/retry, parallel Driver dashboard reads, Customer active-trip recovery/loading polish, Admin count-only payment summary, and disabled-by-default performance telemetry code. These are retained from the verified live baseline. The integrated code adds the server-authoritative universal fare version/quote checks, dormant online payout endpoints and panels, R40 commission warning, payout review/settlement safeguards, financial SQL candidates, tests, and runbook. Existing dispatch, OTP, notification, cancellation, Yoco, and ledger files outside the Release 4 inventory remain byte-identical to the live source.

Both `MOOVU_ONLINE_PAYOUTS_ENABLED` and `MOOVU_UNIVERSAL_FARE_23_ENABLED` are OFF when unset; `.env.example` explicitly documents `false`. The Admin payout API returns unavailable or rejects writes before payout-table access when OFF. The Driver payout API checks existing identity linkage and returns unavailable before payout-table access when OFF. Phase 2 recovery calls the new payable RPC only when the payout flag is ON. The fare increase is server-authoritative and OFF without an explicit true value. Neither flag was enabled here.

## Validation and schema boundary

| Check | Result |
| --- | --- |
| Full automated regression | **PASS: 361/361**, including booking, locked fare, Driver/dispatch/OTP, Admin, pricing and payout unit contracts |
| TypeScript | **PASS** (`npx tsc --noEmit`) |
| ESLint | **PASS**, zero errors, five warnings |
| Production build | **PASS**, 216/216 static pages with process-only localhost Supabase placeholders and both financial flags false. Initial build without any Supabase URL compiled but stopped at page-data collection; no source change was needed. |
| Git diff | **PASS** (`git diff --cached --check`); 46 approved Release 4 files staged before this report, no migration under `supabase/migrations/`, no `vercel.json` change |
| Production catalog | **PASS for dormant schema compatibility only.** Fresh read-only query: `trips`, `driver_accounts`, `online_payment_attempts`, `online_driver_payables`, `phase5_policy_at`, and `phase2_driver_finance_position` exist; the four checked base relations have RLS. `online_payout_batches` is absent, so payout activation remains blocked. |

The four reviewed Release 4 SQL documents remain **candidates**, not applied migrations. Production function-body equivalence, managed-service recovery, authenticated integrated Customer/Driver/Admin flows, live Yoco fees, bank evidence, and physical payment/notification outcomes were not certified by this local merge/build. The prior isolated financial rehearsal remains valid evidence for its tested source and schema, but does not substitute for a production-target staged comparison of this new integrated commit.

## Review and release gates

Files changed relative to live: the 46 Release 4 files listed by `git diff 606c8106..HEAD --name-only`, plus this report. There were no unresolved merge conflicts and no unrelated changes. Final integrated commit: recorded in the release handoff after commit creation.

Next gate: review the exact integration commit, verify effective Production flags remain OFF, stage an unaliased Production-target build, perform non-mutating authenticated Customer/Driver/Admin comparison and monitor runtime errors before any live promotion. Activation of payouts or universal fares requires separate SQL, external financial evidence, accounting, operational and owner approval. Do not apply the four SQL candidates or activate either flag as part of a dormant application deployment.
