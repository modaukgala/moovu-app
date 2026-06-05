# MOOVU Customer Portal UI/UX Audit

Review date: 2026-06-03

## Scope

Reviewed the customer-facing MOOVU surfaces:

- `/`
- `/book`
- `/ride/[tripId]`
- customer bottom navigation
- customer trip chat sheet
- customer booking and ride-status styling in `src/app/globals.css`

## What Currently Feels Messy

- The home page has a strong booking entry, but the right-side map illustration, trust cards, and driver CTA compete with the main "Book a ride" action on small screens.
- The booking sheet exposes many controls at once after expansion: ride options, stop discount details, ride timing, payment, metrics, trip summary, and push notification prompt.
- The add-stop feature is visible as a full route control even before most riders need it.
- The ride status page repeats fare, distance, duration, payment, and status in several places.
- The ride status page stacks driver, safety, route, OTP, receipt, controls, and fare records as equal-weight cards, which makes the next action harder to scan.
- Some customer-facing states use operational language such as GPS freshness and planned release times that are useful internally but clutter the rider experience.

## Duplicated Information

- Ride status repeats fare total in the top KPI row, the map bottom card, and the ride-total detail section.
- Distance and duration appear in the top KPI row, map sheet, and detailed fare section.
- Share trip appears in both safety and action controls.
- Status appears in the page header, status chip, map overlay, and fare detail section.

## Buttons/Actions That Compete

- Home page: driver application actions compete with booking.
- Booking page: favorite places, add stop, schedule, payment, push notifications, ride options, and confirm are all visible in the same flow.
- Ride status: receipt, share, rate, done, report issue, cancellation, add stop, call, SOS, and chat can appear as separate buttons across multiple cards.

## What Should Be Hidden Until Needed

- Add stop should remain collapsed until the rider asks for it.
- Fare details should appear only when a fare exists.
- Push notification enable should stay secondary.
- Cancellation controls should stay below primary ride status information.
- Detailed fare/route records should become secondary after the live status and driver card.

## Main Action By Screen

- Home: Book a ride.
- Booking: Confirm ride once pickup, destination, and fare are ready.
- Ride searching: keep request open, retry status if needed, or cancel when appropriate.
- Driver assigned: contact/chat driver and check OTP.
- Ongoing trip: share trip or view live progress.
- Completed trip: receipt, rate, done.

## Spacing and Mobile Layout Issues

- Booking suggestions can feel close to the confirm bar on small screens.
- The booking expanded sheet can feel dense when ride options, add-stop pricing, trip summary, and push prompt are all visible.
- Ride status cards are readable but too many same-weight cards reduce hierarchy.
- Desktop/tablet can stay denser, but mobile needs fewer visible cards per step.

## Recommended Fixes Applied

- Simplify the home page around a single booking CTA and lightweight trust row.
- Reduce driver-facing CTA visibility on the customer home page.
- Collapse add-stop controls behind one small "Add stop" affordance.
- Show fare summary only after the route is ready.
- Keep trip summary compact and customer-facing.
- Make place suggestions stronger and keep them above the confirm area on mobile.
- Make ride status more map-first and group secondary fare/controls below the live state.
- Reduce customer-visible operational details.

## UX Direction

Each customer screen should clearly show:

1. Where the rider is.
2. Where they are going.
3. What is happening now.
4. What the rider should do next.

MOOVU should use Uber/Bolt-like clarity without copying their brand, layout, or protected visual language.
