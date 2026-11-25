# Business Intelligence metric authority and limitations

Reporting uses Africa/Johannesburg midnight boundaries with an inclusive start and exclusive end. Custom periods allow up to 31 calendar days to cap scans and chart buckets. Operational comparisons use adjacent equal-day windows and are suppressed for current partial days, incomplete coverage and zero comparison baselines. Booking cohorts show recorded status at observation time, without reconstructing historic state.

Bookings use trip creation, completions use completion time, cancellations use cancellation time, and offers use issue time. Current debt is an observed balance. Finance reuses the role-checked earnings endpoint and its recorded trip snapshots, settlements, verified Yoco evidence and posted membership evidence. Aggregate CSV uses the same authorised card values and carries coverage. There are no customer identifiers or free-text cancellation details in BI responses or exports.

Operational scans are capped at 10,000 trips per cohort and 5,000 offers. Simple offset paging across a changing database does not guarantee snapshot consistency. The trip scan reconciles per-page exact counts and duplicate IDs. Offer evidence covers the issued window only; first-offer latency means the first observed offer in that window. Lack of recorded offers does not prove no attempts occurred. Recorded telemetry, customer links and latency can be incomplete.

Deferred work includes transactional FIN-04, authoritative operating areas, dispatch candidate coverage, regional administration, complete customer identity and historical cohorts, historical driver availability intervals, historical commission balances, scalable database aggregation, and full raw-data exports. Marketing attribution, guaranteed actual mileage, bank settlement and profit without authoritative expenses are unsupported by the BI contracts.

Authenticated runtime, rendered browser acceptance and isolated database query performance remain unverified. The Phase 4 browser tooling limitation still applies.
