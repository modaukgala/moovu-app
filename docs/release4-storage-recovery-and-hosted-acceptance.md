# Release 4 Storage recovery and hosted acceptance

## Current read-only inventory (26 October 2026)

Production Supabase project `mvazbszenqahgqpznhhq` has seven private buckets. The three populated buckets contain 741 current objects and 1,024,980,864 metadata bytes: `driver-docs` 366, `payment-proofs` 31, and `phase6-evidence` 344. The other four buckets are empty. No object has a missing size, archived marker, versioned marker or delete marker. The count is current inspection evidence, not a permanent assumption. The October 26 encrypted database archive has Storage **metadata only**, not these bytes ([Supabase backup documentation](https://supabase.com/docs/guides/platform/backups)).

## Private object-byte backup

Run the credential-free check first:

```powershell
pwsh -NoProfile -File ".\scripts\release4-storage-backup.ps1"
```

Before starting a download, verify the existing production key through the private read-only bucket-list request:

```powershell
pwsh -NoProfile -File ".\scripts\release4-storage-backup.ps1" -VerifyCredential
```

Use an existing `service_role` JWT or `sb_secret_` key from project `mvazbszenqahgqpznhhq`. The launcher rejects public keys and malformed credentials. Opaque secret keys are sent on `apikey`; legacy service-role JWTs use `apikey` and Bearer authorization. Only a sanitized status is printed. A 400/401/403 response is not proof of a valid key; confirm the key's project and type in Supabase Dashboard > Settings > API Keys before retrying. No key rotation is required.

After credential verification, a read-only listing check exercises every bucket and folder without downloading object bytes:

```powershell
pwsh -NoProfile -File ".\scripts\release4-storage-backup.ps1" -VerifyListing
```

If it fails, share only the sanitized category, bucket identifier, HTTP status, content type, pagination offset, folder depth and retry count. The helper retries transient 429 and 500/502/503/504 responses at most twice with bounded backoff; it does not retry authorization or malformed-request failures. Object names, response bodies and credentials are excluded from diagnostics.

The owner ran this check on 26 October 2026 using the verified production secret key. It returned `STORAGE_OBJECT_LIST_VERIFIED`: seven buckets, 741 objects, 1,024,980,864 bytes, no object download and no production mutation. The earlier `STORAGE_OBJECT_LIST_SERVER_FAILED` response lacked the bucket and HTTP status needed for a definitive root-cause attribution. No invalid pagination or request-body parameter was reproduced. Supabase read-only request logs showed successful object-list calls and no observed 402 or object-list 5xx in the queried window; this is not proof that a transient failure never occurred.

After a fresh read-only inventory confirms the current count and bytes, the owner can run from this repository:

```powershell
pwsh -NoProfile -File ".\scripts\release4-storage-backup.ps1" -Execute -ExpectedCount 741 -ExpectedBytes 1024980864
```

The values above reflect the inspection on 26 October 2026. If they drift, stop, inspect the change read-only and supply the new verified values. The launcher privately prompts for the **existing** production service-role key and a separate 20+ character backup passphrase. Neither belongs in chat, Git, command arguments or logs. The script calls only Storage list and authenticated GET APIs; it has no upload, delete or policy mutation path.

Each object streams through AES-256-GCM into a protected D: backup set with generic numbered filenames. Its original bucket, path, metadata, size and plaintext SHA-256 live only in the authenticated encrypted manifest. A fresh inventory must match after the last download. The certifier decrypts each object into an ACL-protected isolated D: directory, verifies its size and SHA-256, then immediately deletes the plaintext file and finally the temporary directory. A separate later restore-readability check uses:

```powershell
pwsh -NoProfile -File ".\scripts\release4-storage-backup.ps1" -CertifyArchiveName "<sanitized storage-backup directory name>"
```

The backup set itself is retained outside Git. No object is restored to production. A changed or missing object, failed authenticated download, size mismatch or failed restore must yield BLOCKED; do not count a partial set as certified. The documented procedure backs up current object bytes and paths. It does not make an October 26 database snapshot a zero-loss recovery point for later database writes.

The cryptographic path passed synthetic exact byte/count restoration, wrong-context and tamper rejection, and a two-object encrypted-set restore. Credential handling, pagination, nested paths and sanitized HTTP failure categories passed focused synthetic checks. The credential-free launcher preflight passed.

**Storage object-byte backup and isolated restore: CERTIFIED on 26 October 2026.** The owner ran the private launcher and supplied only the sanitized result `STORAGE_BACKUP_AND_RESTORE_CERTIFIED`. The protected archive `storage-backup-20261026T190237Z-315644c7c41e` contains 741 encrypted object files plus an encrypted manifest, representing 1,024,980,864 source bytes. Its manifest SHA-256 is `8741040D59D150012B6BBF816DBCFF051D2487ED497E437A275A233DD33D4576`; an independent local hash matched the owner result. The helper reported `restoreCertified:true` after authenticated isolated decryption and per-object size/hash checks, with no Storage writes requested. The temporary restore directory was removed. A separate read-only production metadata count still returned 741 objects and 1,024,980,864 bytes. This certifies this Storage object-byte archive; it does not certify writes to Storage or the database made after its snapshot.

## Hosted payout acceptance

The separate Vercel project `moovu-critical-reliability-release` exists, but its project environment inventory contains zero variables and its effective deployment protection and Supabase binding are not established. The only other active Supabase project available for MOOVU testing, `tangtlmdpnvmoviwrgvd`, is shared historical disposable infrastructure: read-only counts show 858 Auth users, 262 trips, 180 financial transactions and 322 Storage objects; it has no Stage 2 payout table or migration history. These records must be preserved. This project is **not** a clean isolated Stage 2 acceptance target.

Hosted acceptance therefore remains BLOCKED. The smallest safe next step is an owner-approved dedicated non-production Supabase target with separate Auth, Database and Storage, then verified Vercel test-project bindings with no production service role, Yoco, Firebase sends or workers. Only then can synthetic Admin/Driver/RLS and feature-gate acceptance run. No hosted deployment or feature activation occurred in this task.
