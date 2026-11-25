# Phase 4 rendered acceptance

## Verification boundary

The existing checkout has no Playwright, Puppeteer or DOM test runner installation and no authenticated synthetic Admin browser fixture. Safari is installed, but browser availability alone does not supply local authentication or synthetic Admin records. No rendered acceptance was run. Use an approved isolated fixture that provides the existing session, authenticated role and mocked operational and financial responses for owner, admin, dispatcher and support. Keep external network access disabled and use no real credentials or records.

## Rendered checklist

- At 1440px, 768px and 375px, verify the current-page indicator, equivalent authorised desktop and mobile destinations, disclosure state, sign-out access and contextual titles.
- Verify loading, zero, unavailable and error states on the dashboard and receipts. Verify that pending proofs, awaiting confirmation and Yoco exceptions lead to their corresponding queues.
- Follow the Driver Profile archive shortcut with spaces, ampersands, apostrophes and percent signs. Exercise back, forward, cleared filters, page reset and canonical trip links.
- Verify Drivers, Trips and Dispatch filter labels, long names, card alternatives, contained table scrolling, independent Board pagination and reachable actions.
- Use keyboard only to open and close menus and dialogs. Test Tab, Shift+Tab, Escape, initial focus, restored focus, removed openers, repeated dialogs, and existing disabled and busy actions.
- Check zoom, focus visibility, contrast, status text, announcements, assistive technology and supported themes. These checks do not establish compliance by themselves.

## Executed source coverage

- `adminNavigation.test.ts` covers UI-01A, UI-07A and UI-10A route and role resolution.
- `phase4Acceptance.test.ts` covers UI-05A URL and request encoding, UI-08A receipt transport and request-state handling, and UI-02A dashboard source contracts.
- `paymentAccountingRoutes.test.ts` covers exact receipt authorization, allocation and signing. `businessScalability.test.ts` covers directory and Board query contracts used by UI-03A / UI-04A.
- UI-06A / UI-09A keyboard, focus and actual responsive behaviour require the rendered checks above. Source semantics are not browser execution.

The targeted acceptance suite exercises the dashboard queue-card contract and pager bounds, scoped busy state and independent Board query parameters. It also exercises exact active and unassigned Board filters in a mocked route. These checks leave rendered dashboard parity, DOM interaction, back and forward, keyboard focus, theme, viewport, zoom and screen-reader acceptance outstanding.
