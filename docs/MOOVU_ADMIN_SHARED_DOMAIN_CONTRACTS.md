# Admin shared domain contracts

## Shared Admin presentation contracts — 10 October 2026

`src/lib/admin/identity.ts` formats canonical `drivers` and Customer names consistently. A missing name shows a plain-language fallback; a raw UUID is never substituted as the primary person label. Canonical IDs remain unchanged in links, requests and records. Dashboard, dispatch, trips, reviews, settlements, earnings, reports and onboarding use this display rule.

`src/lib/admin/paymentReviewCounts.ts` defines the pending/waiting payment-review population for both Dashboard and Sidebar. A successful review emits an in-window refresh event after the server confirms it; the event does not perform any mutation. Phase 6 Dashboard and Sidebar review counts continue to use `loadAdminReviewMetric()` and the same three current-application statuses.

The Dashboard's completed-trip fare and commission cards describe stored trip values, not collected cash or posted ledger revenue. Its completed-trip aggregate pages through the full matching result rather than silently summing only the first Supabase page. The earnings API no longer advertises obsolete fixed commission rates as current policy. Historical subscription metrics are labelled as history, not a general work gate.

Contracts live in `src/lib/admin/applicationSummary.ts` and `src/lib/admin/domainContracts.ts`. Each displayed value must identify its source, scope and observation time. A null value means unavailable; it must not be rendered as zero, paid or approved.

## Driver and application

Canonical identity is `drivers.id`. Current Phase 6 application is the highest cycle for that Driver; older cycles remain historical. `phase6_enrollments.existing_driver` and cycle number identify re-application, independently of the current review state. Legacy Driver verification is labelled `legacy` and not folded into a Phase 6 review decision. Current review states are `SUBMITTED`, `RESUBMITTED` and `UNDER_REVIEW`. Corrections require Driver action; approval is an application decision, not proof of online eligibility. `drivers.online/busy` reports presence, not permission to work. The Admin read summary deliberately marks operational eligibility `not_evaluated` until the trusted runtime authority is queried.

The Dashboard card, sidebar badge and Phase 6 review tab share the same three-status definition. The metric links to `/admin/onboarding`; the legacy `/admin/applications` queue remains visibly separate. If the metric query fails it is unavailable, never zero. The review list paginates rather than silently truncating at the former 200-row cap; it fails closed if its 10,000-row safety cap is reached.

## Finance — design contract only

| Concept | Authority and scope | Do not equate with |
| --- | --- | --- |
| Trip fare | Stored trip fare/final-fare basis and trip ID | An estimate or settled payment |
| Commission amount | Trip policy snapshot or posted ledger entry | Current effective 1,500 bp policy on an old trip |
| Commission outstanding | Authoritative Driver financial position at an as-of time | Sum of visible trip estimates |
| Driver payment verification | `driver_payment_requests` or verified provider event | Posted ledger payment |
| Posted payment | `financial_transactions` and balanced entries | Uploaded POP alone |
| Driver earnings | Trip estimate or ledger basis, explicitly labelled | MOOVU-to-Driver payable or actual payout |
| Driver payable | `online_driver_payables` where installed | Driver-to-MOOVU commission debt |
| Settlement | `driver_settlements`/trusted settlement operation | Payment review approval |
| Payout | Provider-bound payout authority, if present in a future baseline | A settlement request or approved payable |
| Subscription history | Historical subscription events/payments | Current general Driver work eligibility |

The Admin Earnings API still contains a legacy 10%/12% label. Group B must read effective policy and each trip's historical stored basis before changing that label; no historical rate or amount is rewritten here. Existing manual-assignment subscription logic is preserved pending its separate policy review. Financial changes require disposable, ledger-level proof.

## Trips and operations — design contract only

`trips.status` owns Requested, Offered, Assigned, Arrived, Ongoing, Completed and Cancelled display labels. `driver_trip_offers.status` owns offer substates such as Shown, Accepted, Declined and Expired; these are not trip transitions. Dispatch board covers a limited recent population, while Trips covers a wider set. Fare/receipt, Customer identity and notification delivery each retain their own source and timestamp. No timer, OTP, assignment, fare or notification code changed.
