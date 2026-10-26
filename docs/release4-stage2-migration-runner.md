# Release 4 Stage 2 migration runner and remaining gates

## Reviewed input and execution boundary

The runner is `scripts/release4-stage2-migrate.mjs`; the private production-password launcher is `scripts/release4-stage2-migrate.ps1`. The default PowerShell invocation is credential-free and **does not connect to production**. `-ExecuteProduction` is reserved for a separately approved cutover. This document does not authorize that switch.

The runner accepts exactly these files, in order, and checks their bytes before opening a database connection:

| Supabase history version | Source file | SHA-256 |
| --- | --- | --- |
| 20261026110501 | `docs/release4-online-payable-total-separation.sql` | `05B877FE906CEAF1233B46931C21D5D55430D69D935026E9A279DE738D951F7C` |
| 20261026110502 | `docs/release4-phase5-booking-fee-allocation.sql` | `AF6956B37CC1D86E42E3059590E0599524CD69FD46370FCD72C46756F4C7BBD5` |
| 20261026110503 | `docs/release4-online-payout-control-plane.sql` | `50DB1ADFFFFB3ABEE9192F707B22B441B8C92B97F6FB17C84765577E23F15FD9` |
| 20261026110504 | `docs/release4-online-payout-financial-engine.sql` | `D867572E695BA13D627AD20BE19D8F47B603DF430CC831573DD54F7801A94318` |
| 20261026110505 | `docs/release4-manual-partial-payments.sql` | `A5F56087E23A8CCD3266B8DB795E86C7EFA7C3785F1B80AFC80867C190F9A84F` |

Every file has one outer `BEGIN`/`COMMIT`. The runner places the original body, bounded `lock_timeout=5s` and `statement_timeout=120s`, and the matching `supabase_migrations.schema_migrations` row in one transaction. A failed file therefore cannot record success. It rejects a partial or unexpected history for operator review; it never repairs history or blindly resumes financial SQL. A complete rerun reports `STAGE2_ALREADY_APPLIED` after read-only object and financial checks.

Migration 4 checks the exact existing `financial_accounts_account_category_check` definition, existing rows, and owner again just before replacing it. It changes only the reviewed constraint within its transaction. Failure to acquire the required table lock in five seconds stops execution. Do not edit account records or drop other constraints to get past a failure.

## Evidence and limits, 26 October 2026

- Current schema-only archive for project `mvazbszenqahgqpznhhq`: 1,081,535 bytes; SHA-256 `6E0E01BC4DC4D1C3F8531CA7CDF5E8A9C770B9C6ECC85F350FD8B89D663F2CF6`.
- Read-only production catalog: PostgreSQL 17, role `postgres`, three Stage 1 versions present, no Stage 2 versions, expected constraint and owner, required create/history permissions, four financial invariant counts zero.
- Exact runner on an isolated PostgreSQL 17 restore of the current schema archive: five file applications passed, five history versions present, payout objects/RLS present, authenticated direct write denied, four financial invariant counts zero. Second exact run returned `STAGE2_ALREADY_APPLIED` without replay.
- This schema-only rehearsal has no production rows. The October 26 encrypted database backup was independently restored and certified earlier (126 table counts and no invariant mismatches), but this new runner has **not** yet executed against that encrypted data restore. Local owner remapping is not proof of managed-role equivalence; the production catalog checks cover the relevant `postgres` prerequisites without applying SQL.
- Automated tests cover byte-hash rejection, history conflicts, constraint mismatch, wrong fixture destination, stop-on-error ordering, and timeout SQL generation. A live lock-contention rehearsal and a data-backed exact-runner rehearsal remain unverified.

## Storage recovery procedure (prepared, not executed)

The database archive includes `storage.objects` metadata but no object bytes. The current catalog counts 741 objects. [Supabase confirms this backup distinction](https://supabase.com/docs/guides/platform/backups); [its Storage download guide](https://supabase.com/docs/guides/storage/management/download-objects) describes CLI and S3-compatible export options.

1. Authorize a private, read-only Storage export session for the production project. Inventory bucket, key, object version, size, MIME type and metadata from `storage.objects` without logging object names or customer data to chat or Git. Preserve the inventory in an encrypted manifest beside the database snapshot.
2. Check adequate protected D: capacity and a private encryption destination before downloading. Use the Storage API or S3-compatible client with a narrowly handled private credential. Stream each object directly into an authenticated encrypted archive; do not create an unprotected plaintext directory. Record per-object byte length and SHA-256 inside the encrypted manifest, with the original bucket/key/version.
3. Compare downloaded object count and total bytes with the inventory. Objects changed after the inventory need a second pass or a documented snapshot boundary; do not silently certify a mixed point in time. Keep the original database backup immutable.
4. Restore to a **separate** disposable Supabase Storage target using the Storage API, verify private access controls and every recovered byte hash, and check metadata/path parity. Never write directly to `storage.objects` or overwrite production objects; Supabase documents that Storage metadata should be treated as read-only and object operations should use its API ([schema guidance](https://supabase.com/docs/guides/storage/schema/design)).

No Storage object-byte export or isolated object restore was run here. Storage recovery is **PENDING**. A database snapshot also cannot recover legitimate writes made later; application rollback retains the live database.

## Hosted payout acceptance boundary

Use only a separately verified disposable Supabase project with synthetic Admin, Driver A and Driver B identities and a protected Vercel test project. Before any hosted deployment, verify both client and server bindings (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) resolve exclusively to that project. Use test-only or disabled `YOCO_*`; no production `FIREBASE_*`, push worker, dispatch worker, Storage, webhook or financial-worker credentials. Keep `MOOVU_ONLINE_PAYOUTS_ENABLED` and `MOOVU_UNIVERSAL_FARE_23_ENABLED` OFF except in explicitly isolated acceptance sessions. Do not assume Preview defaults are isolated.

The hosted test must prove Admin and Driver payout pages, cross-Driver denial through RLS/API, partial manual assertions and duplicate rejection, independent bank-evidence verification, and disabled background posting/flags. The disposable project and effective Vercel secret bindings have not been certified in this task, so no hosted deployment or authenticated hosted acceptance was performed.

## Release stop conditions

Do not execute production SQL until a separately approved cutover rechecks live migration history, backup/write boundary, Storage requirement, operator monitoring, both flags OFF, webhook continuity, and the exact reviewed commit. Stop on any hash, role, constraint, financial, RLS, history or lock-timeout failure. Do not restore the database snapshot over newer legitimate production writes.
