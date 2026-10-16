# Dispatch and maintenance combined release candidate — 16 October 2026

This candidate starts at the verified live notification source
`2ed552041b9b11d3750897bed1f6ca0db988d8f0` and applies only the reviewed
maintenance commit `6f34274bb9faca4220644199d60778c763bda90a`. The
90-second dispatch commit `e356191651cc8aff4b5da733afd72bfbd91a3195`
is already an ancestor of the live source. The notification reminder remains
present. No production SQL, deployment, scheduler, or feature activation was
performed while preparing this candidate.

## Migration inventory

The three dispatch migrations remain exactly as committed in the live source:

| Migration | SHA-256 |
| --- | --- |
| `20261010185641_dispatch_90_second_matching.sql` | `6A87E1D7853488FB792074DF1562ACC3EF73890F0B4931DE4813345260D0BDDC` |
| `20261010190029_dispatch_90_second_security_correction.sql` | `AEFF2E91DF767741EE6C5E8E38823397A70C9CA651E2A94C6EB8B409F0F8ED47` |
| `20261011103000_dispatch_matching_terminal_lifecycle.sql` | `0739DBBFC7776721FF1B3C963BFF310B3D55A69D41F5C7FF3A914A14935EFA10` |
| `20261012191510_production_admission_gate.sql` | `FB8FAC95631FF7A0A14D5A70D5FB6A22D6CB09AC4FB4F077E3D5CAB2C3E8EB49` |

Read-only production migration history does not contain any of these four
migrations. The maintenance migration changes only admission tables, functions,
triggers, grants, and RLS; it does not rewrite trips, payment history, ledger,
or finance policy. A one-line Windows newline normalization in
`paymentReview.test.ts` fixes a pre-existing test-only comparison failure; it
does not change application behavior.

## Validation completed

- Focused combined tests: 18/18 passed.
- Full source regression: 335/335 passed after the test-only newline fix.
- TypeScript and production compilation: passed. The build used a local-only
  Supabase URL and nonfunctional build keys; it is compilation evidence, not
  authenticated runtime or database acceptance.
- ESLint: zero errors, five existing warnings. Scoped secret-pattern scan and
  Git diff checks: passed.
- Two real, overlapping local PostgreSQL booking/maintenance races: passed.
  The booking-first Owner transition waited 2995 ms; the transition-first
  booking waited 3008 ms and was rejected. The local state returned to NORMAL.
- Existing dispatch concurrency, fairness, 90-second timing, and synthetic
  paid/Cash evidence from `docs/dispatch-90-second-booking-candidate.md` remains
  relevant because the dispatch implementation was not changed in this merge.

## Mandatory release blockers

The available local maintenance database is reconstructed and incomplete:
`trips` is 62 columns / 2 indexes / 7 triggers, while production is 132 / 21 /
9. Local `driver_trip_offers` is 9 / 2 / 2 versus production 23 / 11 / 3.
`dispatch_jobs` is absent locally but has 14 columns / 3 indexes in production.
An attempted accepted-trip lifecycle stopped safely before mutation because
the local `trips` table lacks the production `financial_version` column. Its
transaction rolled back; admission remained NORMAL. This fixture cannot prove
the actual OTP/completion, ledger settlement, or signed Yoco continuation
against production-equivalent schema. The separate Release 3 local fixture is
also incomplete. Catalog counts and local race results are not schema parity.

The owner can produce current schema evidence with the reviewed read-only
`scripts/production-schema-only-export.ps1` helper. It uses the established
production pooler, the locally installed PostgreSQL 17 Docker image, and external CA file with
`verify-full`, a read-only session, a private password prompt, and the
owner-only backup directory. It suppresses raw native diagnostics and reports
only the filename, size, and SHA-256. No table data is included. The owner
should send only that sanitized result; neither password nor schema contents
belong in chat or Git. Codex has not run this helper against production. A
schema archive is compatibility evidence, not a recovery point.

The latest encrypted production backup found locally is dated 12 October.
Read-only production catalog checks found later trip and payment-attempt writes
on 15–16 October. It cannot be restored over those legitimate writes. A fresh
schema-only production export or current encrypted backup must be restored in
an isolated database for migration, trigger, RLS, function, concurrency,
existing-trip, and signed-webhook compatibility checks. Before any production
migration, establish a fresh recovery point and a forward-compatible rollback
that preserves post-snapshot writes. The admission gate deliberately allows
settlement of existing payment attempts; it is not a global write freeze.

At this read-only checkpoint, production remains AUTHORITATIVE with 1500 basis
points for Go and XL, a 5000-cent debt threshold, and subscriptions not
required. Ledger imbalance, duplicate transaction keys, duplicate provider
events, and duplicate payables are all zero. Production has neither `pg_cron`
nor `pg_net` installed, so automatic 90-second HTTP scheduling cannot be
activated as part of this candidate without separately reviewed scheduler
infrastructure. The current production deployment remains
`dpl_6rPtefrNLVaG1HK2tUbX87jvHLzD`.

Until these checks pass, do not apply the four migrations, stage/promote the
combined application, switch maintenance state, or activate the 90-second
scheduler/flag. The live notification deployment remains the rollback-safe
production baseline.
