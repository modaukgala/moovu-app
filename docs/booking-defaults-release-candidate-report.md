# Booking defaults repair - disposable release candidate

Date: 16 SEP 2026. Final status: **NOT_READY** for the complete requested contract.
The omitted-default booking repair passed connected validation with a complete actor-profile fixture.
Production was not changed. A final production-only identity check found an additional blocking FK
dependency: all 1,213 active Customer Auth IDs are missing from profiles, which created_by references.

## 1. Disposable project

- Disposable: `tangtlmdpnvmoviwrgvd`.
- Production: `mvazbszenqahgqpznhhq`, read-only throughout this task.
- Final HTTP run: `b2ac0543`, local server on port 3586 with disposable Supabase credentials.
- Server stopped and both generated Drivers verified offline. Audit fixtures remain on disposable.
- No Git commit/push, deployment, production trip/payment, deletion-FK change or new feature.

## 2. SQL applied

Only disposable received:

1. `disposable_booking_production_parity` from `docs/disposable-booking-parity.sql`.
2. `disposable_phase5_booking_defaults_fix` from the prepared forward repair.
3. `disposable_phase5_booking_fix_repeat_check`: repeated repair, no function change.
4. `disposable_dispatch_job_service_parity` from `docs/disposable-dispatch-job-grants.sql`.

Disposable initially lacked 37 production trip columns and had an older reservation function.
Trip types, nullability, default expressions, relevant checks, dispatch/completion triggers and
reservation function were aligned. Legacy disposable fixture NULLs in pickup/dropoff/default
cancellation/bypass fields were normalized before matching NOT NULL constraints were installed.
The first scaffold attempt rolled back because historical disposable rows violate the production
status check; added checks use NOT VALID, which still fully enforces the production predicate on
new/updated rows. Historical fixtures were not deleted or rewritten to change their statuses.

Relevant RPC definitions match production after normalizing CRLF. Service-role access to
`dispatch_jobs` was missing only on disposable; SELECT/INSERT/UPDATE now matches the required
production server access. RLS stays enabled; no client grants or policies were loosened.

Residual booking-path differences: UUID default generator differs, but this RPC always
sets its own UUID; disposable has extra Phase 3 online-payment guards (normal Cash/Transfer
passes these); some checks are not historically validated; deletion FK differences were left
untouched as required. The missing disposable created_by FK turned out to be material: the positive
fixture had a profile row, but production Customers do not. Therefore the full production Customer
booking path is NOT yet faithfully proved; the missing-profile case cannot be signed off here.

## 3. Root cause and repair review

The original full-row `jsonb_populate_record` INSERT supplies NULL for omitted columns and
bypasses DEFAULT expressions. Adding only an empty attempted-driver array would not fix the
other NOT NULL failures. The forward repair names supplied columns and binds JSON with USING,
so all omitted columns use database defaults. It normalizes missing/JSON-null attempted arrays.
Explicit supplied values remain supplied values; other explicit NULLs still face constraints.

Identifiers are catalog-derived and quoted. JSON values are not interpolated into SQL.
Function signature/identity, SECURITY DEFINER, search_path, service-only grants, actor/price
checks, replay lock, Phase 4 debt guard, Phase 5 quote/credit/audit logic and transaction rollback
are unchanged. No caller-facing payload permission was added. The API still constructs the
server-owned payload; the RPC is not exposed to authenticated/anonymous clients.

Before hash: `5199da6a1dc1cf78208104829d6c47d6`.
Repaired hash: `2995edfe238920f45c67ffe730f76005`.
ACL unchanged: postgres and service_role EXECUTE only.
Search path unchanged: `public, extensions, pg_temp`.

## 4. Authenticated HTTP booking

**PASS.** Real Supabase Auth password login, existing customer row, real Maps distance API,
Phase 5 quote API, then `POST /api/customer/book-trip` -> `phase5_create_trip` -> trips INSERT
-> dispatcher. Cash/Transfer is stored as `cash`; service is `go`; ride type is `now`.
No membership or promotional credit fixture was used for the ordinary booking.

Final ordinary trip: `6afa323e-0874-4910-bd42-bb0f396129a0` (HTTP 200).
First run also booked `fb3d3203-bc29-4b40-bf58-18349adb8ec7`.
A replay using the same booking key returned the same trip without another offer or ledger post.
This is authenticated HTTP/data-path proof, not screenshots or just a direct INSERT.

## 5. Created-trip invariants

**PASS.** Catalog-driven query found zero NULLs among ALL actual NOT NULL columns.
`offer_attempted_driver_ids=[]`, `issue_reported=false`, `cancellation_fee_amount=0`,
`dispatch_priority_score=0`, `completed_without_end_otp=false`. Other omitted database defaults,
including cancellation splits and reliability impacts, are present as defined.
Go locked commission snapshot is 1500 basis points. The legacy commission_pct default of 5 is
unchanged by design; guarded completion updates it to 15 using the locked authoritative snapshot.
This repair is not a commission repricing/backfill.

## 6. Dispatch regression

**PARTIAL / FAIL for two requested assertions.**

- PASS: first offer persisted, trip became offered, expiry job persisted after privilege parity.
- PASS: expired offer was reoffered through authenticated Admin auto-assign HTTP API.
- PASS: authenticated Driver decline persisted; that Driver was excluded from subsequent offers.
- PASS: same booking-key retry duplicated neither offer nor financial posting.
- PASS: actual attempted Driver IDs are stored in `driver_trip_offers` rows.
- FAIL: nearest approved no-subscription/zero-debt Driver was selected by the application but
  rejected by `reserve_trip_offer`; the subscribed second Driver received the offer instead.
- FAIL: legacy `trips.offer_attempted_driver_ids` stays empty after offering. Current candidate
  logic uses offer rows, not this legacy array. Decide whether to synchronize it or formally
  treat offer history as canonical before signing off that specific acceptance requirement.

Production reservation still unconditionally requires active/grace subscription and a future
subscription expiry, despite authoritative policy saying no subscription is required. It also
retains a legacy R100 wallet check, but the separate Phase 2 trigger prevents new work at R50.
Do not remove financial safeguards to fix the subscription conflict.

Timing observation: current application passes 25s escalation/25s acceptance; production RPC
has 10s/30s defaults. Effective tested HTTP offers were 25s/25s. Timing was not changed here.
Expiry testing used scoped disposable deadline updates, then the real expiry/reoffer path;
this does not prove an independently running production scheduler.

## 7. Phase 2 authoritative safety

- PASS: authoritative policy, Go and XL both 15%, limit R50, subscription_required=false.
- PASS: no-subscription Driver finance RPC returns eligible at zero debt and R45.
- PASS: exact R50 returns ineligible for new work.
- PASS: direct disposable reservation at R65 is blocked by the real new-work finance trigger;
  the probe was rolled back, including all fixture updates.
- PASS: a trip already ongoing before the threshold was crossed can finish through the
  actual guarded completion RPC above the threshold, with commission posted once.
- FAIL: reservation's extra legacy subscription gate contradicts the no-subscription policy.

Auxiliary completion fixtures use the real booking/completion/posting RPCs, not customer GPS
or OTP-entry UI; the HTTP booking and dispatch tests are separate. R33.33 auxiliary fare was
used solely to produce exactly R5.00 commission and test the R50 boundary, not as a new fare model.

## 8. Financial safety

**PASS for ordinary non-credit booking and replay.** Direct database verification:

- Financial transactions linked by economic_trip_id OR source_id: 0.
- Legacy Driver wallet transactions: 0.
- Completion business events: 0.
- Promotional credit redemptions: 0.
- Phase 5 booking audit: exactly 1.

No commission, Driver payable, completion ledger or settlement is created by this ordinary
booking. Auxiliary completed-trip fixtures intentionally post 15% commission at completion;
these are isolated disposable tests, not accidental effects of the ordinary booking.
Credit redemption, membership, online payment and cancellation/no-show financial E2Es were not
expanded in this incident task. Their implementation was not changed by the repair.

## 9. Customer-safe failure

**PASS.** A valid future scheduled-booking request intentionally hits the production-equivalent
status check, which does not allow status scheduled. Response: HTTP 500 with only
`We couldn't create your trip. Please try again.` No constraint name or SQLSTATE is returned.
Server diagnostics retained `[book-trip] trip creation failed`, SQLSTATE 23514 and the check name.
The failed database transaction created no successful trip/audit/economic posting.

This negative case also exposes an existing scheduled-status incompatibility; it was not
relaxed or fixed as part of the normal-booking repair.

## 10. Validation results

| Check | Result |
| --- | --- |
| Full `npm test`, rerun after connected testing | 208 pass, 0 fail |
| Booking regression test file (included in full suite) | 4 pass, 0 fail |
| Connected rollback-only default SQL mechanism | 4 cases pass |
| Guarded migration repeat | PASS, same repaired hash |
| Authenticated HTTP harness | 25 pass, 2 fail (27 total); exit 1 intentionally |
| Additional rollback-only debt reservation probe | PASS |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | 0 errors, 3 pre-existing warnings |
| `npm run build` | PASS |
| `git diff --check` | PASS; existing line-ending warnings only |

Final harness file: `scripts/booking-defaults-disposable-e2e.mjs`.
Run from project root with:

```powershell
node --env-file=.env.local --env-file=.env.phase3-e2e.local scripts/booking-defaults-disposable-e2e.mjs
```

It asserts the disposable hostname, overrides Supabase credentials in its child server, blanks
Firebase/FCM/Web Push/email outbound credentials, and stops its own server. Missing notification
configuration in those isolated logs is intentional, not a push-delivery test. It generates
new disposable fixture users/trips per run and retains audit rows, then takes its Drivers offline.

## 11. Production read-only comparison

**PASS for drift verification; FAIL for production recovery readiness.** End-of-test production function definition and 132-column metadata exactly match the
initial read-only snapshot. Production still has the vulnerable INSERT and expected defaults.
The named-column repair remains valid for defaults, but is NOT sufficient to restore production booking.
Production has a validated trips_created_by_fkey: created_by REFERENCES profiles(id).
Read-only join: 1,213 active Customers with Auth IDs; all 1,213 lack the corresponding profiles row.
The RPC sets created_by=p_actor_id, and the API supplies the authenticated Customer user.id. Neither
the inspected registration code nor customer auth helper establishes the missing profiles row.
Consequently these accounts would next encounter FK violation 23503 after the defaults issue is fixed.
The disposable table lacks this FK, and the successful HTTP fixture explicitly created a profile.
That masks this production-only failure; it is a material parity/data prerequisite gap, not release proof.
Production Phase 2 new-work trigger matches the disposable trigger, including R50 protection.
The subscription gate and scheduled-status check are production findings, not invented fixtures.

## 12. Exact intended production SQL object

Only `public.phase5_create_trip(uuid,uuid,text,jsonb,bigint,text,bigint)` via guarded CREATE OR REPLACE.
No production table/column/default/constraint/index/FK/policy/grant/data mutation is required
for the omitted-default repair itself. Additional actor-profile alignment needs a separately reviewed,
approved plan; do not drop, retarget or weaken the FK. The one-function migration alone is insufficient.
DO NOT run either disposable parity SQL file on production.

## 13. Exact application deployment scope

Only incident changes inside `src/app/api/customer/book-trip/route.ts`: empty attempted array,
safe creation/catch errors, safe quote-change response and server diagnostics. Tests and docs
are supporting artifacts, not runtime deployment requirements. The large dirty tree includes
other phases; do not blindly deploy or revert the full route or checkout as this incident patch.
No application source file was additionally changed during this validation-only task.

## 14. Migration rollback

Review-only rollback: `docs/phase-5-booking-defaults-rollback.sql`.
It checks the repaired hash, restores the captured pre-repair function definition and preserves
the function identity/grants. It does NOT remove tables, FKs or audit data. **It reintroduces the
booking outage**, so prefer forward correction; use only with explicit approval and an incident
plan. Rollback execution itself was not required/run in this task.

## 15. Application rollback

Prepare a reviewed inverse patch containing only incident hunks, against the exact production
source revision approved for release. Do not reset/checkout this entire dirty route or repo.
Restoring raw database errors would be a security regression; keep sanitation where possible.
The SQL repair does not depend on the extra API empty-array field because it normalizes it too.
No application was deployed, so no current application rollback was performed.

## 16. Remaining risks and next gate

The booking-defaults SQL is validated with a complete actor fixture, but full sign-off is blocked first
by missing production Customer actor profiles, then the confirmed subscription reservation conflict
and unmet legacy-array acceptance assertion. Reviewed identity alignment (without changing deletion
FKs), scoped dispatch correction and representative disposable revalidation need approval.
Scheduled status incompatibility and effective 25/25
timing are additional recorded findings. Independently running scheduler, real-device push, full
customer-driver UI E2E and unrelated dirty-tree release safety were not proved by this task.
Review evidence in `docs/booking-defaults-disposable-evidence.json`.

## 17. Final status

**NOT_READY** for the complete requested release-candidate contract.
**Booking omitted-default repair: PASS on disposable with actor profile present.**
**Production booking recovery: FAIL / not yet sufficient; missing actor profiles must be addressed.**
Stop gate observed. No production SQL or application release is authorized by these results.
