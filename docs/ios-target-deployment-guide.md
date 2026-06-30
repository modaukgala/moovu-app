# MOOVU Targeted iOS Deployment Guide

MOOVU does not use generic Capacitor commands for App Store packaging. Every build, copy, sync, open, and archive command must choose a target.

## Customer App

Identity:

- App name: MOOVU
- Bundle ID: `za.co.moovu.customer`
- URL: `https://moovurides.co.za`
- Native folder: `ios-customer/`

Commands:

```bash
npm install
npm run build:customer
npm run sync:customer
npm run open:customer
npm run archive:customer
```

Archive output:

```text
build/MOOVU-Customer.xcarchive
```

## Driver App

Identity:

- App name: MOOVU Driver
- Bundle ID: `za.co.moovu.driver`
- URL: `https://driver.moovurides.co.za`
- Native folder: `ios-driver/`

Commands:

```bash
npm install
npm run build:driver
npm run sync:driver
npm run open:driver
npm run archive:driver
```

Archive output:

```text
build/MOOVU-Driver.xcarchive
```

## Safety Rule

Do not run direct Capacitor CLI commands without the npm target scripts. Use the npm scripts instead. The root `capacitor.config.ts` throws when `CAPACITOR_TARGET` is missing so a driver build cannot silently use customer configuration.
