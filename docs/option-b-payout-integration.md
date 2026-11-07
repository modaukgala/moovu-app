# Option B online Driver payout integration

## Scope and activation

This candidate adds a **future-only** Option B policy. It does not change Customer fares, existing payout batches, Yoco collection, dispatch, or bank transfer behavior. The migration adds `online_payout_policy.option_b_effective_at`, which can be set only to a future UTC instant after the existing payout cutoff. `MOOVU_OPTION_B_PAYOUT_EFFECTIVE_AT` must match that recorded instant for the application to display Option B figures. An unset value keeps the current policy.

The separate `MOOVU_ONLINE_PAYABLE_POSTING_ENABLED`, `MOOVU_MANUAL_PAYOUTS_ENABLED`, and `MOOVU_PAYOUT_BANK_VERIFICATION_ENABLED` gates remain independent and default off. This candidate does not enable any of them. No production migration, flag change, payout, or backfill was performed.

## Allocation

For a post-cutoff online trip with a locked R3 Go or R5 Go XL booking fee and matched, verified provider evidence, the existing batch workflow now records immutable item components: 15% commission on the locked ride fare; R1 Driver booking share; R2 MOOVU booking share for Go or R4 for Go XL; half the verified 3.5% percentage fee to each party, with an odd cent assigned to the Driver; and the full verified R2 fixed fee to the Driver. Authorized prior debt remains a separate deduction. The item, batch, approval snapshot, manual-payment verification, and settlement ledger use these same amounts. Legacy batches retain their existing allocation and approval behavior.

The R49 example is R46 ride fare, R6.90 commission, R1 Driver booking share, R0.86 Driver percentage fee, and R2 fixed fee. The payout before any debt is R37.24 **only if** independently verified Yoco evidence matches the expected R1.72 percentage and R2 fixed fee. A missing or different actual fee never becomes a confirmed payout.

The database continues to create a base ride earning payable through the existing guarded posting RPC. The Option B amount is finalized only during the existing payout draft and approval workflow after fee verification. Completed paid trips lacking a posted payable appear as provisional read-only earnings cards; they are excluded from the confirmed payout balance. The Admin and Driver routes use the same server calculation, and the Driver query is filtered to the authenticated Driver before financial reads.

## Reference trip and existing records

Read-only production inspection found trip `3fcc4a44-6708-448a-8017-6fa8134d7492` completed on 1 November 2026 with a successful, matched R49 online payment and no payable row. The existing `MOOVU_ONLINE_PAYABLE_POSTING_ENABLED` gate had remained off, so the completion recovery job did not call the payable posting RPC. There is no verified fee-component evidence for this attempt in the inspected payout tables. Its completion predates any future Option B cutoff; the R37.24 illustration is **not** a lawful automatic backfill amount. A separate, approved historical reconciliation would need actual Yoco evidence, the governing legacy policy, and an auditable posting decision. This candidate leaves the trip unchanged.

## Release boundary

1. Rehearse the exact migration against a current isolated managed-schema copy and synthetic rows; verify grants, RLS, approval, partial manual payment, and both settlement paths.
2. Obtain owner approval for the migration and a future UTC Option B cutoff. Apply the migration with a bounded, hash-pinned runner; verify migration history and financial invariants.
3. Deploy the reviewed application artifact with Option B cutoff unset and posting/payment gates unchanged. Verify the current live policy and rollback compatibility.
4. After separate approval, record the future cutoff in `online_payout_policy` and set the matching server variable. Do not backdate. Activate payable posting or manual payment gates only under their own acceptance and approval process.
5. Before activation, the previous application remains a viable application-only rollback target because the migration is dormant. After any Option B batch exists, roll back only to an artifact that understands Option B booking and fee components; an older reader would mislabel the booking-fee allocation. Retain the additive schema, immutable payout history, and all later financial records. Use compensating transactions for an incorrectly posted amount; never delete a legitimate financial transaction or restore an old archive over newer writes.

## Evidence and open gates

- Pure calculation tests cover R49 and R100, missing/discrepant evidence, cent splitting, debt, and invalid terms.
- The approved Go XL R1/R4 split passes calculation and read-only presentation tests. The completed-trip read model also checks the ride option against its locked R3 or R5 fee.
- Read-only presentation and route tests cover pending earnings, policy cutoff, server-side Driver scoping, and unchanged Admin action gates.
- The local PostgreSQL 17 rehearsal restored the protected schema-only export, applied the six prerequisite payout migrations and the new migration, then used synthetic rows to test draft, approval replay, duplicate prevention, direct settlement, partial manual payments, overpayment rejection, independent review, balanced ledger, and R1 booking-share reclassification. All fixture writes rolled back and the isolated database was destroyed. The local run cannot prove managed Supabase role equivalence or actual Yoco/bank evidence.
- Final checks: 397 automated tests passed, TypeScript passed, ESLint passed with six pre-existing unrelated warnings, and the production build generated 217/217 static pages using local non-production Supabase placeholders. Diff whitespace and focused credential checks passed.
- The owner approved the Go XL R5 split: R1 Driver and R4 MOOVU. The Customer's locked R5 fee remains unchanged.
- Historical reference-trip correction, provider fee intake, actual bank evidence, authenticated hosted Admin/Driver UI acceptance, and production activation remain separate gates.
- The separate synthetic Go XL database rehearsal passed with a locked R5 fee, R1 Driver/R4 MOOVU booking allocation, R6.90 commission on R46 ride fare, R1.79 verified percentage fee (R0.90 Driver/R0.89 MOOVU), R2 fixed fee, and R37.20 net payout. Draft, approval replay, direct settlement, partial manual settlement, and ledger balancing passed. No real provider or bank evidence was used.
- On 7 November 2026, production read-only inspection found the Option B column unapplied, all six prerequisite payout tables and four relevant functions present, and zero unbalanced transactions or duplicate financial keys, provider events, and payables. The live Driver domain resolves to READY deployment `dpl_d2XebCqmJAUHqWcYwHSajfGn8RMW`. Production policy is enabled with its existing 28 October cutoff; Option B has no recorded effective time. Production environment metadata could not be read through the Vercel connector (403); the CLI lists the existing payout visibility and fare variables, but does not expose their values. No Option B server cutoff is configured there.
- Authenticated hosted Admin/Driver acceptance remains blocked: the existing Stage 2 Supabase staging project is INACTIVE. The shared Phase 05g project is also INACTIVE. This task did not resume or change either project, provision accounts, or deploy a test artifact. Route tests cover authorization and Driver scoping, and the local database verifies authenticated-role table-read denial; these do not substitute for managed Auth/RLS and rendered-page acceptance.
