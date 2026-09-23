# Phase 0 Production Migration Execution Report

## Scope and authorization

Owner approval was received on 2026-09-02 for the production database migrations only. No application deployment, commit, push, Phase 1 work, pricing change, Auth configuration change, or outbox activation was authorized or performed.

## Production target

- Project: `moovu-kasi-rides`
- Project ref: `mvazbszenqahgqpznhhq`
- Region: `eu-west-1`
- PostgreSQL: `17.6.1.063`
- Status before execution: `ACTIVE_HEALTHY`
- Database host identity: `db.mvazbszenqahgqpznhhq.supabase.co`
- Verified not to be the disposable project `tangtlmdpnvmoviwrgvd`.

## Repository checkpoint

- Branch: `main`
- HEAD: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`
- The existing modified and untracked worktree was preserved. No reset, clean, restore, stash, commit, or push was performed.

Migration SHA-256 hashes:

- `phase-05b-001-financial-foundation.sql`: `80A88F5D90C6E8C3F4643E58E6781306746449FEE4B7F35E66DD71E5DBF688BC`
- `phase-05b-002-trip-atomicity.sql`: `22F2D0A841B97DF937CBBE70EE55EE77C38153382367591509F73EDD71DEB123`
- `phase-05b-003-applicant-assignment-outbox.sql`: `4A42FCE3674DF602D60308823E0F32C2B5B27DEFEB20A9275BC1786341058ACE`
- `phase-05d-004-retention-security.sql`: `9FB5232E1B9F10277B76CD898F8DF01ED9D8F6760B77BF45A8B8E16344BBE8A3`

## Pre-migration checkpoint

Recorded at `2026-09-02T13:26:28.987747Z` immediately before mutation.

- Trips: 195; completed: 122; active: 0.
- Driver wallets: 50; wallet projection mismatches: 0; maximum difference: R0.00.
- Active-status offer rows: 159 historical stale rows already documented during review; duplicate active trip/driver offer conflicts: 0.
- Ownership/application/commission/cancellation duplicates: 0.
- Completed trips missing fare or commission data: 0.
- Commission rows on non-completed trips: 0.
- Drivers assigned to multiple active trips: 0.
- Busy/active-trip state inconsistencies: 0.
- Wallet transaction constraint allowed exactly `commission`, `payment`, and `adjustment`.
- Driver offer constraint allowed exactly `pending`, `shown`, `accepted`, `declined`, `expired`, and `cancelled`.
- The three migration-002 cancellation audit columns were absent, as expected.

## Migration 001

Applied as `phase_05b_001_financial_foundation` and verified before continuing.

- Eight expected financial RPCs installed.
- Seven expected indexes installed.
- Business-event and notification-outbox tables installed with RLS and server-only mutation grants.
- `app_notifications.event_key` and its per-user uniqueness index installed.
- Direct `anon`/`authenticated` financial mutation grants: 0.
- Public execution grants on migration-001 Phase 0 RPCs: 0.
- Historical financial row counts unchanged.
- Wallet projection mismatches remained 0.

## Migration 002

Applied as `phase_05b_002_trip_atomicity` and verified before continuing.

- Wallet transaction constraint now allows exactly `commission`, `payment`, `adjustment`, and `cancellation_credit`.
- Existing driver-offer status constraint remained unchanged and uses canonical `cancelled`.
- `cancellation_reason_details text null` installed.
- `cancellation_status_at_request text null` installed.
- `cancelled_within_free_window boolean null default false` installed.
- Six trip atomicity functions and the trip-finance protection trigger installed.
- Customer cancellation function includes the reviewed optional `profiles` actor guard.
- Public/anon/authenticated execution grants on externally callable trip RPCs: 0.
- Trips remained 195; completed remained 122; active remained 0.
- Commission rows remained 129; cancellation fees remained 19; no duplicate effect appeared.
- Wallet projection mismatches remained 0.

## Migration 003

Applied as `phase_05b_003_applicant_assignment_outbox` and verified before continuing.

- Six applicant, assignment, and outbox RPCs installed.
- Driver-account and application ownership uniqueness indexes installed.
- Direct `anon`/`authenticated` mutation grants on driver accounts/applications: 0.
- Public execution grants on migration-003 RPCs: 0.
- Duplicate account users, account drivers, and application users: 0.
- Drivers with multiple active trips and active offer conflicts: 0.
- Business-event and outbox row counts remained 0; the worker was not activated.

## Migration 004

Applied as `phase_05d_004_retention_security` and verified.

- Direct `anon`/`authenticated` trip and trip-event mutation grants: 0.
- All seven reviewed financial/audit foreign keys now use `ON DELETE RESTRICT`.
- Historical trip, fee, wallet, settlement, subscription-payment, event, and notification records were retained.
- No orphan wallet, transaction, trip-event, or cancellation-fee records were introduced.

## Post-migration validation

Recorded at `2026-09-02T13:42:59.312391Z`.

- All four migration records exist in dependency order.
- 20 Phase 0 functions exist; all 20 are executable by `service_role`.
- The 19 externally callable Phase 0 RPCs have no `PUBLIC`, `anon`, or `authenticated` execute grant.
- `phase05b_protect_trip_finance()` retains default execute ACL entries, but it is an invoker-rights PostgreSQL trigger function returning the `trigger` pseudotype, not an externally callable business RPC.
- Direct `anon`/`authenticated` mutations on hardened financial objects, trips, trip events, and `app_notifications`: 0.
- Wallet projection mismatches: 0 of 50; maximum difference: R0.00.
- Trips: 195; completed: 122; active: 0.
- Wallet transactions: 129; settlements: 6; subscription payments: 15; payment requests: 20; cancellation fees: 19; application notifications: 8,122.
- Ownership, commission, cancellation-fee, active-assignment, and active-offer conflicts: 0.
- Missing completed fare/commission data and commission-on-non-completed-trip rows: 0.
- Financial/audit orphan checks: 0.

The Supabase security advisor reported no new exposed Phase 0 `SECURITY DEFINER` RPC. It reports informational no-policy notices for the two new server-only tables, which is intentional because table grants are restricted to `service_role`. Other advisor warnings concern pre-existing unrelated functions/Auth configuration and were not changed under this approval.

## Authenticated smoke tests

Database contract authorization was verified through production ACL/grant inspection:

- `service_role` can execute all 20 Phase 0 functions.
- `anon` and normal `authenticated` roles cannot execute the 19 protected business RPCs or directly mutate hardened financial/trip objects.
- Dispatcher and Support therefore cannot directly perform financial mutations through client database access.
- Owner/Admin server-mediated execution is available through the trusted `service_role` contract.

No production trip, financial charge, applicant, or customer record was manufactured for role testing. Real Owner/Admin/Dispatcher/Support/Customer/Driver HTTP route tests are deferred to the separately approved application deployment smoke gate, because the reviewed application code has not been deployed and forcing those tests now would risk live data.

## Deployment and activation status

- Application deployment: **not performed**.
- Git commit/push: **not performed**.
- `PHASE05_OUTBOX_ENABLED`: **not enabled**.
- Outbox worker: **not activated**.
- Phase 1/Yoco/MOOVU+: **not started**.
- Rollback: not required; every migration and checkpoint succeeded.

## Verdict

# PHASE 0 PRODUCTION DATABASE MIGRATION COMPLETE

# READY FOR APPLICATION DEPLOYMENT REVIEW
