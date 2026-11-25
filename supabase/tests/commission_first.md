# Commission-First disposable verification

## Baseline and isolation

Use a fresh, verified disposable Supabase/Postgres database with local Auth roles and an absolute Unix socket directory. The test runner accepts local socket authentication without saved passwords. Verify the socket, port, owner and database name against the isolated cluster configuration before providing the acknowledgement. The database name must start with `fin04_disposable_`. Use a separate fresh database for each scenario. Never point a Supabase CLI at a linked project.

Restore the approved disposable application schema baseline first. It must contain the Phase 05b financial and trip RPCs, the Phase 1 ledger and extensions, Phase 2 policy tables, Phase 3 provider-independent payment tables and Phase 5 fare snapshot columns. In dependency order, the corresponding checked-in contracts are `docs/phase-05b-001-financial-foundation.sql`, `docs/phase-05b-002-trip-atomicity.sql`, `docs/phase-1-ledger-migration.sql`, `docs/phase-2-commission-driver-finance-migration.sql`, `docs/phase-3-yoco-provider-independent-foundation.sql`, and `docs/phase-5-customer-monetisation-migration.sql`. Those files assume the application baseline and are not a clean-room bootstrap. Use the intended baseline's installed completion, cancellation and proof-review versions. The synthetic setup requires Phase 2 OFF or SHADOW and asserts that the FIN-04 policy is initially inactive. Apply the FIN-04 migration last.

From the repository root, after independently verifying the target, set explicit values for its socket, port, owner and database. Example names below are placeholders for verified local targets.

```bash
export FIN04_SOCKET=/absolute/path/to/verified/disposable/socket
export FIN04_PORT=55432
export FIN04_GLOBAL_ROLE=postgres

for scenario in allocation same-trip settlement manual-race same-driver different-driver combined accrual cancellation; do
  export FIN04_DATABASE="fin04_disposable_${scenario//-/_}"
  export FIN04_ISOLATED_ACK="$FIN04_DATABASE"
  psql -X -w -h "$FIN04_SOCKET" -p "$FIN04_PORT" \
    -U "$FIN04_GLOBAL_ROLE" -d "$FIN04_DATABASE" -v ON_ERROR_STOP=1 \
    -c 'select current_database(), inet_server_addr(), current_user' || break
  # Proceed only after matching each identity to the verified disposable cluster.
  psql -X -w -h "$FIN04_SOCKET" -p "$FIN04_PORT" \
    -U "$FIN04_GLOBAL_ROLE" -d "$FIN04_DATABASE" -v ON_ERROR_STOP=1 \
    -f supabase/migrations/20261125120000_commission_first_payout_records.sql || break
  bash supabase/tests/commission_first_run.sh "$scenario" || break
done
```

The runner generates all actor, customer, driver, trip, payment and review evidence. The allocation run checks Go and Go XL cent arithmetic, exact and excess zero-net cases, historic and paid payable preservation, stable ordering, rollback and replay, followed by the existing manual and security tests. The race runner starts a separate psql process for A and waits for its readiness marker, emitted after the write and before commit. Session B uses its own connection and must observe lock contention for the same-driver scenarios. The independent-driver case requires B to complete while A's allocation is still invisible to B. The timeout is a test deadline and the lock error or visibility check is the overlap assertion.

Use the psql error and SQL filename to locate a failed assertion. Inspect the installed function definitions and the synthetic journals on that same isolated target before rerunning. Preserve original output. Destroy each disposable database or restore its isolated baseline after the run because fixture setup and concurrency rounds commit. The allocation, zero-net, security and sequential manual test transactions roll back their own changes.

### Known source-level concerns to verify

- The Phase 1 ledger posting function locks participating account rows. Different drivers can share the customer-funds and adjustment-clearing accounts. The independent-driver test flags that contention.
- The checked-in legacy combined-proof function reads cached wallet debt. FIN-04 recovery changes authoritative debt without refreshing that cache. The combined-proof test flags a stale-cache over-application.
- The accrual test asserts the requested 15% rate. Some checked-in legacy completion contracts apply 10% for Go. A mismatch identifies a baseline or completion-policy discrepancy.

## Reporting contract

| Value | Authoritative source |
|---|---|
| External commission receipts | `driver_settlements.amount_paid` by recorded settlement date |
| Internal commission recovery | `commission_first_payout_allocations.recovered_cents` by allocation time |
| Total settled commission | External receipts plus internal recovery for the same reporting window |
| Current commission debt | `phase05b_driver_debt.balance_due`, with external `total_settled` and separate `internal_recovery` |
| Original and effective payable | `commission_first_effective_payables` by payable ID. Use the effective amount once. |
| Recorded external payments | `commission_first_manual_payments.amount_cents` by `paid_on` |
| Independently verified payments | Recorded payments joined to `commission_first_manual_verifications` by payment ID, with verification time available independently |

The settlements API's `total_paid` represents external settlements. The earnings API currently leaves payout metrics unavailable and the payout estimate reader has no allocation integration. Readers must use the effective payable rather than adding the original payable and the allocation snapshot. For a persisted allocation, outstanding recorded and verified balances subtract their respective paid subtotals separately. Internal recovery is excluded from external cash receipts.

Keep the policy table empty until reporting integration, isolated verification and separate rollout approval. The service-role SQL client is a trusted server boundary. The Admin POST endpoint independently authenticates the user, checks the stored financial role and passes only that session identity as the actor.
