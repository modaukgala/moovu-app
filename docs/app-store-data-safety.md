# MOOVU App Store Data Safety Notes

Last updated: 2026-05-06

This document supports Google Play and Apple App Store data safety forms. It is not formal legal advice; MOOVU should still complete a legal/privacy review before public app submission.

## Contact

- Support email: admin@moovurides.co.za
- Privacy policy path: /privacy-policy
- Terms path: /terms
- Contact path: /contact

## Data Collected

- Account information: name, cellphone number, auth user ID, account status.
- Location data: customer pickup location, typed pickup/destination, driver GPS/manual availability while using the app.
- Trip data: pickup, destination, route, distance, duration, fare, ride option, trip status, timestamps, OTP workflow status, driver/customer references.
- Driver data: application details, vehicle details, documents, approval status, online status, earnings, commission, subscription status.
- Payment and receipt data: private payment proof uploads, review status, receipts, fares, commission records, subscription payment records.
- Notifications: push subscription endpoint/token and role context used for ride/payment alerts.
- Device/app data: browser/PWA runtime data needed for maps, push notifications, authentication, and diagnostics.

## Purpose of Collection

- Create and manage customer, driver, and admin accounts.
- Book, dispatch, track, complete, and receipt rides.
- Calculate fares and route estimates.
- Verify trips with OTP security.
- Review driver applications, payments, commissions, subscriptions, settlements, and receipts.
- Send operational push notifications.
- Provide support, safety review, fraud prevention, and compliance records.

## Linked to User

Most operational data is linked to a customer, driver, admin account, trip, payment, or receipt. Push subscriptions are linked to the logged-in user role for delivery and access control.

## Shared Data

MOOVU shares limited information required to operate the service:

- Assigned drivers see customer pickup/dropoff and relevant customer/trip details.
- Customers see assigned driver and vehicle details where available.
- Admins see operational records required for dispatch, support, finance, and compliance.
- Platform processors may include Supabase, Vercel, Google Maps, and push notification infrastructure.

MOOVU does not sell personal information.

## Security Practices

- HTTPS transport.
- Supabase authentication.
- Server-side fare recalculation.
- Server-side role/ownership checks.
- OTP trip security.
- Protected admin payment review flows.
- Storage bucket access should be restricted by Supabase policies. Driver documents and payment proofs should remain private; admins should view payment proofs through short-lived signed URLs.

## Deletion and Support Process

Users may request access, correction, or deletion by emailing admin@moovurides.co.za. Some records may be retained when required for legal, tax, financial, fraud-prevention, support, or safety reasons.
