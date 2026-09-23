# Phase 4B Stage B production installation

- Target: `mvazbszenqahgqpznhhq`.
- Source: `docs/phase-4b-phase1-cutover.sql`.
- SHA-256: `00e8a99c886f772f9dbb7dc40a5bbc5356d522a8553132bc6af30a5d2cfa676c`.
- Migration: `20260914161339_phase4b_stage_b_phase1_cutover`.
- Execution: successful, with 5-second lock timeout and 120-second statement timeout.

| Phase 1 function | Before body MD5 | After body MD5 | Disposable-validated MD5 |
| --- | --- | --- | --- |
| `phase1_validate_financial_source` | `c044f379c0d338a9ede7126f8f112f9c` | `8fe30d1d1cbb612e08928469f7a9d700` | `8fe30d1d1cbb612e08928469f7a9d700` |
| `phase1_post_financial_transaction` | `9e30259ebf45690656a4ef41a0a13359` | `b450d3c81ce224ace2006745c5cd293a` | `b450d3c81ce224ace2006745c5cd293a` |

Post-install definitions retain their original signatures and `{postgres,service_role}` execute ACL. At verification, Phase 4 policies, assessments, liabilities, compensations, grace cycles and quotes remained zero. Financial transaction and ledger-entry counts remained 3 and 6. Stage A remained installed. Stage B is dormant until application integration and immutable policy activation complete.
