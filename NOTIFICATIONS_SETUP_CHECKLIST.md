# MOOVU Notifications Setup Checklist

## Firebase project

- Create or confirm a Firebase project for MOOVU.
- Add an Android Firebase app with package name `za.co.moovu.app`.
- Download `google-services.json` and place it at `android/app/google-services.json`.
- Create a Firebase Web app and copy its public config values into `.env.local` and Vercel.
- Create a Firebase service account key for server sending.
- Store the service account values in environment variables only. Do not commit the JSON key.

## Required environment variables

Client/public:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_VAPID_KEY=
```

Server/private:

```bash
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

`FIREBASE_PRIVATE_KEY` can use escaped new lines. The app converts `\n` to real newlines before initializing Firebase Admin.

Existing push/test support:

```bash
PUSH_INTERNAL_API_KEY=
NEXT_PUBLIC_SITE_URL=https://moovurides.co.za
```

## Supabase table

- Review and run `docs/fcm-notifications-migration.sql` in Supabase SQL editor or your migration workflow.
- Confirm `public.fcm_tokens` exists.
- Confirm these columns exist: `user_id`, `role`, `token`, `platform`, `device_id`, `app_source`, `is_active`, `last_used_at`, `created_at`, `updated_at`.
- Confirm RLS is enabled.
- Confirm users can read/delete their own rows and writes happen through the server API.
- Confirm service role access is available in Vercel through `SUPABASE_SERVICE_ROLE_KEY`.

## Android

- Confirm `android/app/google-services.json` exists.
- Confirm Android package name is `za.co.moovu.app` in Firebase and `android/app/build.gradle`.
- Confirm `@capacitor/push-notifications` is installed.
- Confirm `android.permission.POST_NOTIFICATIONS` exists in `android/app/src/main/AndroidManifest.xml`.
- Run:

```bash
npx cap sync android
npx cap open android
```

- Test on a real Android 13+ device and accept the notification permission prompt.
- Background/terminated push must be tested on a physical device, not only browser dev tools.

## iOS-ready notes

- Add an iOS Firebase app when the iOS project is created.
- Place `GoogleService-Info.plist` in the iOS app target in Xcode.
- Upload an APNs key to Firebase.
- Enable Push Notifications capability in Xcode.
- Enable Background Modes with Remote notifications in Xcode.
- Run on a Mac:

```bash
npx cap add ios
npx cap sync ios
npx cap open ios
```

## Local and Vercel checks

- Add the Firebase client and admin env vars to `.env.local`.
- Add the same values to Vercel project environment variables.
- Keep `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`, and `SUPABASE_SERVICE_ROLE_KEY` private.
- Do not add Firebase service account JSON files to git.

## Test flow

1. Run `npm run build`.
2. Run `npx cap sync android`.
3. Log in as a customer and open `/book`.
4. Tap **Enable notifications** and confirm a token row appears in `fcm_tokens`.
5. Log in as a driver and open `/driver`.
6. Tap **Enable notifications** and confirm the driver token row has role `driver`.
7. Log in as an admin and open `/admin/notifications`.
8. Tap **Enable notifications** and use the role test sender.
9. Create a customer booking and confirm the selected/eligible driver receives **New Ride Request**.
10. Accept, arrive, start, complete, cancel, and chat on a trip. Confirm the affected user receives the expected push.

## Common errors

- `Firebase Admin is not configured`: add `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`.
- `Missing Firebase web notification environment variables`: add the `NEXT_PUBLIC_FIREBASE_*` values and restart Next.js.
- Android token does not generate: confirm `android/app/google-services.json` is present and package name matches Firebase.
- Permission denied: enable notifications in Android app settings or browser settings.
- Token saves but no delivery: check Firebase service account env vars, `fcm_tokens.is_active`, and Vercel runtime logs.
- Migration warning about missing columns: run `docs/fcm-notifications-migration.sql`.
