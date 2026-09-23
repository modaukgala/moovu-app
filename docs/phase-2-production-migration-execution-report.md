# Phase 2 production migration execution report

## Result

**BLOCKED BEFORE EXECUTION.** The approved migration was not applied because
the final production preflight found four active trips and two active offer
reservations. The owner-approved procedure requires migration execution to stop
when an unexpected production state exists.

No production SQL mutation was executed. All database queries in this run were
SELECT-only.

## Approved migration contract

- Production project ref: `mvazbszenqahgqpznhhq`
- Production project: `moovu-kasi-rides`
- Migration: `docs/phase-2-commission-driver-finance-migration.sql`
- Required SHA-256:
  `cdf1bed0e09c6b431691eed32e45d49e09351abfc464206e9a6404bc965b11be`
- Recomputed SHA-256:
  `cdf1bed0e09c6b431691eed32e45d49e09351abfc464206e9a6404bc965b11be`
- Hash result: PASS
- Migration execution timestamp: not applicable; migration was not executed

## Repository safety state

- Branch: `main`
- HEAD: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`
- Worktree: existing modified and untracked work present and preserved
- `git diff --check`: PASS; line-ending warnings only
- Reset, clean, stash, revert, commit, and push: not performed

## Production target verification

Target verification passed before the read-only SQL preflight:

- Supabase project route contained `mvazbszenqahgqpznhhq`;
- the project dashboard displayed the project URL
  `https://mvazbszenqahgqpznhhq.supabase.co`;
- the SQL editor executing the preflight was the project-specific editor for
  `mvazbszenqahgqpznhhq` and identified `moovu-kasi-rides` / `main` /
  `PRODUCTION`;
- the target did not contain the disposable ref `tangtlmdpnvmoviwrgvd`;
- the database returned `current_database() = postgres`,
  `current_user = postgres`, and server address
  `2a05:d018:135e:16cc:2b22:f20e:35f5:1fa8`.

## Quota state immediately before the blocked execution

The organization remained in its previous-cycle egress grace period. Current
organization usage was below quota:

- billing cycle: 22 August 2026 through 22 September 2026;
- current egress: 2.001 GB of 5 GB, 40%;
- current egress overage: 0 GB;
- grace-period end: 19 September 2026;
- current storage: 0.678 GB of 1 GB, 68%;
- current database size summary: 0.073 GB of 0.5 GB, 15%;
- current Realtime peak: 7 of 200;
- current MAU: 144 of 50,000;
- current Realtime messages: 4,266 of 2,000,000.

The production dashboard reported `Healthy`, NANO compute, 100% request success
over the sampled hour, and no Advisor issues. The database reported
`transaction_read_only = off`, `default_transaction_read_only = off`,
`pg_is_in_recovery() = false`, and zero active schema migrations. The quota and
write-availability gate therefore passed.

## Final pre-migration database snapshot

Snapshot timestamp: 2026-09-11 04:44:36.787391 UTC.

| Check | Result |
|---|---:|
| Trips | 240 |
| Completed trips | 133 |
| Cancelled trips | 103 |
| Requested trips | 3 |
| Offered trips | 1 |
| Active trips | 4 |
| Active `shown` offer reservations | 2 |
| Completed gross fare | R9,764.00 |
| Completed assessed commission | R951.30 |
| Driver wallets | 53 |
| Wallet balance due | R317.00 |
| Settlements | 7 / R634.30 |
| Payment requests | 29 / R3,761.70 submitted |
| Subscription payments | 20 / R2,695.00 |
| Cancellation/no-show fee records | 25 / R180.00 assessed |
| Financial accounts | 0 |
| Financial transactions | 0 |
| Financial ledger entries | 0 |
| Pending ledger transactions | 0 |
| Phase 2 tables present | 0 |
| Phase 2 functions present | 0 |
| Phase 2 trip columns present | 0 |

The four active trips were created on 10 September 2026 between
19:30:22 UTC and 19:46:55 UTC. The two `shown` offers were created on
10 September 2026 at approximately 19:30:26 UTC. No production records were
changed while establishing this evidence.

## Execution and post-installation gates

- Migration execution: NOT STARTED
- PostgreSQL migration error: none; no migration statement ran
- Transaction rollback: not applicable
- Partial Phase 2 objects: none detected
- Expected Phase 2 objects installed: no
- Function/security matrix: not applicable before installation
- RLS/grant verification: not applicable before installation
- Post-install invariants: not applicable before installation
- Application smoke checks: not run after the blocker

## Resulting production state

Production remains on its pre-Phase-2 database schema. Phase 1 ledger tables
remain empty. Phase 2 database tables, functions, trip snapshot columns, and
triggers remain uninstalled.

Phase 2 remains OFF. SHADOW and AUTHORITATIVE remain OFF. The 15% commission
and R50 restriction are not active. Subscription eligibility is unchanged. No
opening balance or financial ledger posting occurred. Historical financial
evidence was not rewritten.

No application deployment, Yoco work, Phase 3 work, commit, or push occurred.

## Blocker and smallest safe remediation

Exact blocker: three `requested` trips, one `offered` trip, and two `shown`
offer reservations were active during the final production preflight.

Production impact: none from this task; the migration did not start and the
database remained writable and healthy.

Smallest safe remediation: allow the normal MOOVU trip/offer workflow to reach
a quiet state, without changing or deleting production records for migration
convenience. Then obtain a fresh execution instruction and repeat the complete
hash, target, quota, health, active-trip, and active-offer preflight before
running the exact migration.

## Final verdict

PHASE 2 PRODUCTION MIGRATION BLOCKED

---

## Retry attempt 2 — successful installation

The prior blocked attempt above is retained as historical evidence. A fresh
owner-authorized retry was performed only after repeating every production
gate and observing a quiet window.

### Repository and migration identity

- Attempt date: 11 September 2026
- Branch: `main`
- HEAD: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`
- Existing modified and untracked work: preserved
- `git diff --check`: PASS; line-ending warnings only
- Migration: `docs/phase-2-commission-driver-finance-migration.sql`
- Applied SHA-256:
  `cdf1bed0e09c6b431691eed32e45d49e09351abfc464206e9a6404bc965b11be`
- SQL editor payload length: 20,640 characters, matching the exact local file
- Production project ref: `mvazbszenqahgqpznhhq`
- Disposable ref excluded: `tangtlmdpnvmoviwrgvd`

The production project was verified through its project-specific dashboard,
project URL `https://mvazbszenqahgqpznhhq.supabase.co`, project-specific SQL
editor route, `moovu-kasi-rides` / `main` / `PRODUCTION` identity, and database
server identity. The SQL ran only through the editor scoped to the production
project ref.

### Quota and project health

Immediately before migration:

- organization egress: 2.001 GB of 5 GB, 40%; current overage 0 GB;
- organization storage: 0.678 GB of 1 GB, 68%;
- production database size: 69.93 MB;
- grace period from the previous-cycle egress excess ends 19 September 2026;
- project status: Healthy;
- compute: NANO;
- database read-only settings: off;
- recovery/standby state: false;
- active schema migrations: 0;
- HTTP 402 or paused/restricted state: not present.

The quota and write-availability gate passed.

### Fresh quiet-window preflight

Initial retry snapshot: 2026-09-11 04:51:07.634042 UTC.

Final immediate quiet check: 2026-09-11 04:52:06.485435 UTC.

| State | Initial retry | Final immediate check |
|---|---:|---:|
| Requested trips | 0 | 0 |
| Offered trips | 0 | 0 |
| Assigned trips | 0 | 0 |
| Arrived trips | 0 | 0 |
| Ongoing trips | 0 | 0 |
| Active pending/shown offers | 0 | 0 |
| Concurrent schema migrations | 0 | 0 |

Before execution, Phase 2 tables, functions, triggers, and trip columns were
all absent. Phase 1 ledger counts were 0 accounts / 0 transactions / 0 entries.

### Execution result

- Database policy creation timestamp: 2026-09-11 04:54:10.780236 UTC
- SQL execution: SUCCESS
- Supabase result: `Success. No rows returned`
- Transaction: committed successfully
- PostgreSQL error: none
- Partial state: none detected
- Manual statement patching: none

### Installed schema contract

Installed tables, all with RLS enabled:

- `phase2_finance_policy`
- `phase2_shadow_reconciliations`
- `phase2_historical_finance_exceptions`

Installed nullable trip columns:

- `commission_policy_id uuid`
- `commission_basis_points integer`
- `commission_rounding_version text`
- `commission_locked_at timestamptz`

Installed and enabled trip triggers:

- `phase2_snapshot_new_trip_trigger`
- `phase2_guard_trip_commission_snapshot_trigger`

Installed indexes:

- `phase2_finance_policy_pkey`
- `phase2_finance_policy_policy_key_key`
- `phase2_historical_finance_exceptions_exception_key_key`
- `phase2_historical_finance_exceptions_pkey`
- `phase2_shadow_reconciliations_operation_key_key`
- `phase2_shadow_reconciliations_pkey`

All 18 Phase 2 primary-key, unique, check, and foreign-key constraints were
present and validated. All nine expected Phase 2 functions were present. Every
function had `search_path=public, pg_temp` fixed in function configuration.

### Function security matrix

| Function | PUBLIC | anon | authenticated | service_role | Security definer |
|---|---:|---:|---:|---:|---:|
| `phase2_contract_version()` | denied | denied | denied | allowed | no |
| `phase2_current_policy()` | denied | denied | denied | allowed | yes |
| `phase2_driver_finance_position(uuid)` | denied | denied | denied | allowed | yes |
| `phase2_finance_eligibility(uuid)` | denied | denied | denied | allowed | yes |
| `phase2_guard_trip_commission_snapshot()` | denied | denied | denied | allowed | no |
| `phase2_lock_trip_commission_snapshot(uuid)` | denied | denied | denied | allowed | yes |
| `phase2_post_trip_commission(uuid,uuid)` | denied | denied | denied | allowed | yes |
| `phase2_post_verified_driver_payment(uuid,uuid)` | denied | denied | denied | allowed | yes |
| `phase2_snapshot_new_trip()` | denied | denied | denied | allowed | no |

`phase2_post_verified_driver_payment` retained all reviewed fail-closed checks:
service-role authentication, non-null actor identity, owner/admin actor role,
and rejection while Phase 2 is OFF. No payment RPC was invoked and no financial
record was manufactured.

For all three Phase 2 tables, PUBLIC, anon, and authenticated had no SELECT,
INSERT, UPDATE, or DELETE privilege. `service_role` had SELECT only and no
direct mutation privilege.

### Phase 2 control state

Post-install verification at 2026-09-11 04:55:26.333740 UTC found exactly one
policy row:

- policy key: `phase2-driver-finance`
- mode: `OFF`
- effective date: null
- Go commission: 1,500 basis points
- Go XL commission: 1,500 basis points
- debt limit: 5,000 cents
- warning threshold: 4,000 cents
- subscription required: true

The policy values are installed configuration only. With mode OFF and no
effective date, the 15% commission and R50 restriction are not active.

Phase 2 row state:

- shadow reconciliations: 0
- historical exceptions: 0
- trips with any Phase 2 snapshot value: 0
- financial accounts: 0
- financial transactions: 0
- financial ledger entries: 0

No opening balance, commission, payment, reconciliation, or other ledger
posting occurred during installation.

### Historical data comparison

| Measure | Immediate pre | Immediate post | Difference |
|---|---:|---:|---:|
| Trips | 240 | 240 | 0 |
| Completed trips | 133 | 133 | 0 |
| Completed gross fare | R9,764.00 | R9,764.00 | R0.00 |
| Completed assessed commission | R951.30 | R951.30 | R0.00 |
| Driver wallets | 53 | 53 | 0 |
| Wallet balance due | R317.00 | R317.00 | R0.00 |
| Settlements | 7 / R634.30 | 7 / R634.30 | 0 / R0.00 |
| Payment requests | 29 / R3,761.70 | 29 / R3,761.70 | 0 / R0.00 |
| Approved payment requests | 25 | 25 | 0 |
| Cancellation/no-show records | 25 / R180.00 | 25 / R180.00 | 0 / R0.00 |
| Subscription payments | 20 / R2,695.00 | 20 / R2,695.00 | 0 / R0.00 |

Historical financial evidence was preserved. The migration did not update any
legacy trip, wallet, settlement, payment, cancellation, subscription, or
Driver eligibility record.

### Eligibility, invariants, and smoke checks

Driver eligibility remains under the existing pre-Phase-2 application and
subscription rules. No Driver was restricted at R50, no subscription block was
removed, and no Phase 2 ledger balance became authoritative.

Post-install invariants:

- unbalanced ledger transactions: 0
- orphan ledger entries: 0
- orphan financial transactions: 0
- forbidden duplicate sources: 0
- invalid reversals: 0
- duplicate opening balances: 0
- partial finalized financial transactions: 0

Safe public application checks:

- Customer portal `https://moovurides.co.za/`: HTTP 200
- Driver portal `https://driver.moovurides.co.za/driver`: HTTP 200
- Admin portal `https://admin.moovurides.co.za/admin`: HTTP 200
- sampled 500-level responses: 0

No user was impersonated and no trip, payment, or authenticated production
record was created.

### Final safety confirmation

- Exact approved migration hash applied: yes
- Correct production project used: yes
- Migration succeeded without partial state: yes
- Phase 2 mode: OFF
- SHADOW: OFF
- AUTHORITATIVE: OFF
- 15% commission activation: not active
- R50 restriction: not active
- Subscription requirement: unchanged and true
- Opening balances: not posted
- Historical evidence: preserved
- Application deployment: not performed
- Yoco: not performed
- Phase 3: not started
- Commit or push: not performed

### Retry verdict

PHASE 2 PRODUCTION DATABASE MIGRATION COMPLETE

READY FOR PHASE 2 APPLICATION DEPLOYMENT REVIEW
