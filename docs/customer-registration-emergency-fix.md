# MOOVU Customer registration emergency fix

Date: 25 October 2026 (Africa/Johannesburg).
Scope: standalone hotfix; no production writes or deployment.

## Confirmed production failure

Read-only Vercel inspection confirmed READY production deployment
`dpl_AHkG9ztJr9zeLQHnWPjisgAcKDB7`, source
`7caa67a91a17f5e0fd1536f2863445299de5818e`, production branch main.
The standalone branch is `fix/customer-registration-emergency-20261025`, worktree
`D:\Users\KN Mudau\Desktop\Websites\moovu-registration-emergency`.
It starts at the live SHA, not the blocked dispatch checkpoint.

Five bounded production application log records contain Auth `email_exists`
(422) followed by the registration endpoint's generic 500 response. Matching
Supabase aggregate logs contain five `/admin/users` email_exists failures. No
email addresses, names, passwords, tokens or response bodies were reported.

The deployed registration and email-check handlers call `admin.listUsers()`
without pagination, then treat absence from that page as account absence.
Production has 1,690 Auth users. The real isolated Auth default page contains
50 users. An existing identity outside that page is therefore incorrectly offered
registration; createUser correctly rejects the duplicate and the application
mislabels it as an unexplained persistence failure.

There is also a partial-registration dead end: email lookup finds an Auth user
but returns exists=false when the Customer row is absent. The UI offers signup
again, which conflicts with the existing Auth identity. Production aggregate
inspection found two customer-metadata Auth identities without Customer rows;
this is aggregate evidence, not proof of how either individual record arose.

Production recorded eight Auth creations and seven Customer creations in the
bounded preceding 24-hour check. The evidence does **not** establish that all
genuinely new registrations fail. The confirmed reported failure is duplicate
Auth email handling and incomplete identity discovery/recovery, not an assumed
global RLS outage, SMS outage or missing unique index.

## Schema and security checks

Read-only production metadata confirms Customer Auth and phone unique indexes,
Auth foreign key, required name/phone/status fields, email column, and the
`p0_customer_actor_profile` trigger. Customers has RLS enabled and no direct
client policies; service-authorized APIs provide profile access. No grants, RLS,
triggers, constraints, Auth configuration or migrations were changed.

The hotfix preserves the existing signup contract: email/password plus a contact
cellphone. It does not implement phone/SMS authentication. The existing new-user
`email_confirm: true` behavior is unchanged, not newly introduced by this fix.
No unknown phone is marked verified, no phone_confirm is set, and unverified
existing Auth email identities remain unverified and cannot sign in. A separate
product decision is required if new-user email verification is to replace the
current auto-confirm contract; this hotfix does not claim to implement that.

## Changes

1. A shared server lookup explicitly pages Auth at 1,000 users/page, with a
   ten-page cap. Errors or incomplete scans fail closed rather than create users.
   Canonical Auth email wins over user-editable legacy aliases across all pages;
   ambiguous aliases fail closed. Metadata is not used as role authorization.
2. Email lookup routes an existing Auth identity to sign-in even if its Customer
   profile is missing. It no longer exposes metadata-derived names for an orphan.
3. Duplicate Auth/Customer uniqueness failures return safe 409 guidance. Known
   verification/invalid-detail failures have safe messages; transient or unknown
   failures return 503 and a sign-in/retry path rather than schema details.
4. Removed the old unreachable existing-user password/metadata update branch.
   Registration never resets a password, deletes an Auth user, or blindly retries
   user creation. Supabase uniqueness remains the final race authority.
5. Profile repair remains behind a validated Auth session and uses that user's
   ID. When no Customer exists, authoritative profiles/driver_accounts checks
   reject Driver/Admin identities before repair; lookup errors fail closed.
6. Legacy missing-email-column fallback now requires a missing-column error code,
   not any error message mentioning email. Email uniqueness errors cannot silently
   fall back to dropping email from a new profile.
7. Registration/check-phone validate number formats without changing shared legacy
   normalization used by other app flows. The three supplied SA formats map to
   existing `0xxxxxxxxx` storage; no historical phone values were rewritten.
   This is format normalization, not carrier assignment or ownership verification.
8. Email-first UI no longer interprets digits within an email as a cellphone.
9. Registration logs contain only bounded code/category and an opaque correlation
   ID, never raw Auth errors or submitted details. Profile persistence diagnostics
   likewise omit raw database details.

## Files changed

```text
src/app/api/customer/register/route.ts
src/app/api/customer/check-phone/route.ts
src/app/customer/auth/page.tsx
src/lib/customer/server.ts
src/lib/customer/registration.ts
src/lib/customer/registration.test.ts
scripts/certify-customer-registration.mjs
docs/customer-registration-emergency-fix.md
```

No dispatch, Realtime publication, financial, fare, payment, onboarding or loading
animation file is part of this standalone diff. No SQL Editor code is required.

## Validation and reproduction

Focused tests cover format equivalence/rejection, pagination after page one,
incomplete lookup rejection, canonical-email precedence, safe error classification,
strict missing-column fallback and no Auth mutation/phone-confirm code path.

Integration command:

```text
node scripts/certify-customer-registration.mjs
```

The harness creates a uniquely guarded `registration_cert_<12 hex>` database from
the existing local schema-only fixture, not production records. It starts real
local GoTrue and PostgREST behind a local HTTP proxy and the actual Next app.
Provider credentials are stripped; browser nonlocal requests are blocked. No real
emails, SMS, push notifications, trips or payments are created. Synthetic Auth
padding is cloned from a real synthetic GoTrue row, excluding generated columns;
the test proves the target is absent from page one before testing lookup.

Early fixture attempts failed because incomplete hand-seeded Auth rows were not
valid GoTrue list results. The corrected fixture has 2,004 valid synthetic Auth
rows at the pagination checkpoint. The proxy also now preserves the API-version
response header needed for the SDK to expose Auth error codes. A development
server browser attempt hit JSON/refresh interference. These failed runs are not
claimed as full journey passes. Final certification uses an isolated production
Webpack build/start instead of development hot reload.

The concurrency assertion requires one successful signup, exactly one Auth
identity, and a safe 409 conflict or 503 retry state for the competing request;
after completion, retry must return 409. It does not promise that every concurrent
GoTrue uniqueness race immediately returns 409 rather than a temporary failure.
No automatic creation retries are used to force that result.

### Current results

- Full regression suite: **354/354 PASS**, including six focused registration tests.
- Explicit TypeScript: PASS. Full ESLint: PASS, zero errors/five existing warnings.
- Actual isolated production Webpack build and server: PASS, executed within the
  integration harness with only synthetic local Auth/REST configuration.
- Real Auth/API assertions have passed duplicate lookup beyond page one,
  creation/login/logout, strict phone forms, profile fault/recovery, role isolation,
  verification rejection, concurrent identity uniqueness and Customer ownership.
- Full real Auth/HTTP/production-build browser run: **40 assertions PASS**,
  isolated database `registration_cert_6ba2587ced76`. The actual browser signs in
  and reaches /book; a separate fresh browser context starts with email, completes
  the signup form, fails safely while offline without creating an identity, then
  reconnects, creates the Customer and reaches /book. No trip or ledger entry
  was created. Driver/Admin password login remained functional and Customer
  profile-recovery attempts for those roles returned 403.
- Final repeat on the same source: **40/40 PASS** in
  `registration_cert_6eeed6ef6c87`, including an email containing more than ten
  digits (still correctly treated as email) and a non-vacuous API ownership check.
- Frontend production artifact scan: 275 JavaScript files inspected, zero
  service-role JWT literals found. This is a scoped check of the isolated build,
  not a universal secret-scanning guarantee.
- Git diff whitespace check: PASS; dispatch checkpoint worktree remained clean.
- Earlier development-server attempts and fixture failures above are retained as
  failed/incomplete runs, not counted as successful certification.
- Physical Android/iPhone registration: NOT TESTED.
- Production mutation/deployment: NONE.

## Deployment and rollback

Do not deploy automatically. Before approval, finish the validation below, review
this eight-file diff, pin the standalone hotfix commit, scan staged content for
credentials, and confirm live baseline has not drifted. This task has not committed
or pushed the hotfix. Never merge or deploy the instant-dispatch checkpoint as
part of this release.

The local dependency directory is an ignored junction to the already installed
matching baseline dependencies. No package/lockfile change was required. Webpack
production builds are used for local certification; cloud installation must use
the committed lockfile, not that machine-specific junction.

No database migration or RLS rollback is needed. Application rollback target is
the inspected deployment above, subject to revalidation at release time. Keep all
legitimate newly created Auth users and Customer rows; do not delete accounts or
restore an old database snapshot to roll back application code. Rolling back will
reintroduce the known pagination/recovery bug, so prefer a reviewed forward fix if
recovery behavior is the only issue.

Production acceptance after explicit release approval: new consenting Customer
signup, existing Customer login by phone/email, duplicate email guidance, partial
profile sign-in recovery where applicable, booking-page entry, and Driver/Admin
login. Do not generate a trip/payment merely to validate registration. Compare
safe correlation IDs and error-code counts; public HTTP 200 alone is not proof.

## Decision

**GO for standalone hotfix release review after final checks; production deployment
remains approval-gated and has not occurred.**
No claim is made that production registration is already fixed. Remaining known
limits: bounded Auth-list scanning adds requests and deliberately stops at 10,000
users; a separately reviewed indexed identity lookup may be appropriate later.
Phone-only lookup cannot discover an Auth-only orphan safely from a missing
Customer row; the recovery path explicitly uses the existing account email.

References: [Auth list pagination](https://supabase.com/docs/reference/javascript/auth-admin-listusers),
[Auth administrative creation/confirmation](https://supabase.com/docs/reference/javascript/auth-admin-createuser).

## Controlled release authorization - 25 October 2026

The owner subsequently authorized deployment of this standalone registration fix.
Preflight rechecked live baseline `7caa67a91a17f5e0fd1536f2863445299de5818e`
and rollback deployment `dpl_AHkG9ztJr9zeLQHnWPjisgAcKDB7` as READY.
The 354-test suite passed again. Earlier statements about approval/deployment above
describe the pre-authorization state, not a waiver of release verification.

Release scope is exactly the eight files listed above. No SQL, RLS, Auth provider
settings, production environment settings or dispatch activation is authorized or
required by this deployment. Application-only rollback preserves all database
writes; never restore a database snapshot to revert this hotfix.

Use an exact committed source upload to `moovu-app`, build with that project's
existing production configuration, stage without assigning domains, verify, then
promote. Do not upload the prior local build containing isolated test keys. No
GitHub/main push is necessary or authorized as part of this controlled CLI release.
Actual deployed identifiers and smoke outcomes belong in the post-release report.
