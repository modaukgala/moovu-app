# MOOVU Manual Surge Pricing

MOOVU currently supports admin-controlled manual surge pricing for new bookings only. Existing trips and historical fares are not changed.

## Current Modes

| Mode | Label | Multiplier | Customer message |
| --- | --- | ---: | --- |
| `normal` | Normal | 1.0 | Standard pricing |
| `busy` | Busy | 1.1 | Busy area pricing included |
| `heavy_demand` | Heavy demand | 1.2 | High demand pricing included |
| `rain_event` | Rain/Event | 1.4 | Weather or event pricing included |

The maximum supported surge multiplier is `1.4`. Customers see only the final estimate and a simple note when surge is active.

## Safety Rules

- Surge is controlled by admin-only server APIs.
- Customer clients never choose the surge mode or multiplier.
- `/api/customer/book-trip` re-fetches active surge and recalculates the fare server-side.
- If the pricing settings table is missing or unavailable, the app defaults to Normal pricing.
- Surge applies only to new bookings after the setting changes.

## Future Automatic Surge Plan

The current code is structured so future automatic logic can choose a mode before fare calculation. Future sources can include:

- Peak-time pricing.
- Off-peak discounting.
- Area demand.
- Driver supply shortage.
- Weather or event signals.

Any future automatic system should still keep a hard cap, server-side validation, admin visibility, and clear customer messaging.
