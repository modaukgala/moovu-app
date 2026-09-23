# MOOVU Phase 5 Completion Report

## Production result

Phase 5 Customer monetisation became effective in production on 2026-09-15 at 09:22:00 UTC under immutable policy `phase5-2026-09-owner-v1`. The final application deployment is `dpl_3sbEU2mCVMQXWPBMBKcX4JBbWPqc` and is aliased to `moovurides.co.za`.

## Policy

- MOOVU+: 9,900 cents for 30 days, with no automatic renewal.
- Go service fee: 300 cents.
- Go XL service fee: 500 cents.
- Active-member service-fee waiver: 100%.
- Referrer reward: 2,000 cents promotional credit.
- Referee reward: 1,000 cents promotional credit.
- Credit expiry: 90 days.
- Referral qualification: first eligible completed ride.
- Currency: ZAR.

## Migration package

- `phase5_customer_monetisation_foundation` — `docs/phase-5-customer-monetisation-migration.sql` — SHA-256 `8433372903755f43fae695e928c07eb85781e86cfb86ab16c0feefc9eb8420fb`.
- `phase5_atomic_operations` — `docs/phase-5-atomic-operations.sql` — SHA-256 `370e0c913e21c53d0ffa8258fe81ee002180f73c09828ac9a4e09c46498cbc7d`.
- `phase5_owner_policy_activation` inserted the immutable owner policy with `created_at=2026-09-15T09:17:46.204212Z` and `effective_from=2026-09-15T09:22:00Z`.

Both migration files were replayed successfully on disposable project `tangtlmdpnvmoviwrgvd` before production installation. Production project identity was confirmed as `mvazbszenqahgqpznhhq`, status `ACTIVE_HEALTHY`.

## Architecture and safety

The booking API calculates fare server-side, checks Phase 4 debt before Phase 5 economics, snapshots the policy, ride fare, fee, waiver, credit, Customer total, and Driver basis, then creates the trip and redeems FIFO promotional credit in one database transaction. A stable booking key makes retries idempotent; an advisory transaction lock prevents concurrent Customer credit overspend; changed totals fail with `PHASE5_QUOTE_CHANGED` for reconfirmation.

Post-cutover ride fare excludes the legacy embedded fee. Customer total and Driver basis are separate: membership waivers and promotional credit never reduce Driver entitlement or the Phase 2 commission basis. Pre-cutover and already in-flight trips have no Phase 5 snapshot and continue on their stored legacy economics.

The completion transaction posts a distinct cash service-fee receivable and booking-fee revenue journal only for the unwaived, non-credit portion. Metadata records `cash_received_by_moovu=false`; promotional credit journals are explicitly non-cash. Referral qualification and both rewards occur in the same completion transaction and use stable idempotency keys.

Membership proof submission remains `SUBMITTED`. Only the authenticated Owner/Admin server route can approve or reject it. Approval posts the verified Transfer/EFT control/deferred entry and activates one 30-day period atomically. Approval while active extends from the current expiry. Duplicate or concurrent approval replays do not create another period or journal.

All Phase 5 tables have RLS enabled and direct grants removed from `public`, `anon`, and `authenticated`. Privileged mutations require the service role, with Customer or Owner/Admin identity checks inside the RPC. The Supabase advisor reports the expected informational “RLS enabled, no policy” notices for these server-only tables and no Phase 5 anonymous/authenticated security-definer exposure.

Phase 5 uses `phase5_referral_relationships`; the existing legacy `referral_relationships` schema and rows are not changed.

## Validation

- Focused Phase 5 tests cover fare separation, R3/R5, member waiver, credit capping, minimum fare/surge behavior, immutable policy, atomic booking, Driver basis, referral controls, RLS/grants, membership approval, cash service-fee accounting, and legacy referral isolation.
- Full repository regression suite passed.
- TypeScript passed.
- ESLint passed with zero errors; three unrelated existing unused-variable warnings remain.
- Production build passed with all 179 routes generated.
- `git diff --check` passed; the credential scan found no embedded credential values in tracked application/migration/script sources.
- Authenticated disposable HTTP E2E passed for Customer/Admin authorization, membership submit/approve/replay, credit issue/visibility, authoritative quote, waiver/credit application, route calculation, real booking, and stored financial snapshots.
- Disposable database E2E passed for booking replay, rollback on quote drift, FIFO credit, true overlapping credit booking, concurrent membership approval, membership activation, and ledger balance.
- Disposable referral E2E passed with true overlapping qualification calls and exactly one R20/R10 reward pair.
- Disposable completion E2E passed through the authoritative completion RPC with a 10,000-cent Driver basis, exactly one balanced 300-cent service-fee journal, no fake MOOVU cash, and replay suppression.
- Admin action E2E passed for rejection, bounded adjustment, supported unspent-credit reversal, replay, audit, and balancing.

## Production verification

Immediately after the effective time, `phase5_policy_at(now())` selected `phase5-2026-09-owner-v1`. Homepage, booking, MOOVU+ Customer/Admin pages and login routes returned 200. Protected Phase 5 APIs rejected unauthenticated requests. The deployment reported `READY` and recent error-log inspection returned no errors.

Historical totals remained 262 trips and 138 completed trips. The one pre-existing in-flight trip remained a legacy trip. Phase 5 trips, memberships, membership payments, credits, redemptions, referral relationships, and audit events were all zero immediately after activation, proving there was no backfill or automatic economic action. Posted ledger imbalance count was zero. Phase 4 policy `phase4-2026-09-owner-v1` remained active. Phase 2 remained `SHADOW`, 1,500 basis points, 5,000-cent debt limit, with Driver subscriptions required.

Natural-event reconciliation is pending because no genuine qualifying Phase 5 production event existed during immediate verification. No fake production trip or payment was created.
