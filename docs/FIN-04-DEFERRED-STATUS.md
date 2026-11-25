# FIN-04 deferred status

Base checkpoint: `499e3d2a44f5ed1b57134e9e0c693fb626425a52`.

The deferred branch preserves the integer-cent calculator, payout migration draft, atomic allocation and legacy payable reconciliation, manual payment and independent verification routines, authenticated Admin mutation boundary, and synthetic acceptance tests.

No migration or isolated database test has run. Keep the payout policy inactive. Review shared ledger account contention, cached debt in legacy combined-proof approval, and effective Go commission definitions against the approved 15% policy before activation.

Remaining integration covers Admin Driver Payouts, authoritative Driver Earnings payout records, and financial reporting. External driver payments remain manual. The checkpoint carries no production approval.
