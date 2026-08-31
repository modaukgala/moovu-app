# READ-ONLY / TEST FIXTURE / NOT FOR AUTOMATIC EXECUTION

The canonical fixture is `docs/dispatch-job-retry-hardening-migration.sql`.
Keep that existing SQL file unchanged; do not create another copy.

For this P0 release, it is included solely as static text consumed by
`src/lib/dispatch/reliability.test.ts`. The test uses `readFileSync` with a
module-relative URL and checks text patterns. It does not execute SQL, connect
to Supabase, or verify the currently installed production function.

The fixture retains historical migration instructions to preserve its exact
contents. Those instructions are not part of this release procedure and must
not be executed automatically or manually under this release authorization.
Do not add the fixture to a migration runner, deployment hook, or SQL Editor.
The user separately reported all four production database checks as TRUE.

Content review on 2026-08-31 found no secrets, credentials, production IDs,
tokens, or environment values. PostgreSQL role names such as `service_role`
are schema identifiers, not keys or credentials.

SHA-256 of the unchanged local SQL file:

`1D341B1026BA4DA79E89E670C8977223D89742945DAE42BBE25BF53CB1CB66C1`

Git may normalize line endings when committing; this hash records the local
file bytes before and after test packaging, not a normalized Git blob.

The test, canonical SQL fixture, and this notice belong together in any
approved release commit. The separate historical stale-recovery migration,
development logs, and unrelated documentation are not part of fixture packaging.
