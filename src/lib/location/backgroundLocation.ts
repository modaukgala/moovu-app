import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Native background location for the MOOVU Driver app.
 *
 * Uses @capacitor-community/background-geolocation (installed in the native
 * shells). On Android it runs a foreground service with a persistent
 * "MOOVU Driver is online" notification, which keeps location updates and the
 * app process alive while the phone is locked or another app is open. On iOS
 * it uses the "location" background mode.
 *
 * The web build talks to the plugin through the Capacitor bridge, so this file
 * is safe to deploy before the new app versions are released: on older app
 * builds (or in a browser) the plugin is missing and we simply return null.
 */
type BgLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  bearing: number | null;
  speed: number | null;
  time: number | null;
};

type BgError = Error & { code?: string };

type BackgroundGeolocationPlugin = {
  addWatcher(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (position?: BgLocation, error?: BgError) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
};

const PLUGIN_NAME = "BackgroundGeolocation";
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(PLUGIN_NAME);

export function isBackgroundLocationAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(PLUGIN_NAME);
}

export type BackgroundFix = {
  lat: number;
  lng: number;
  heading: number | null;
  speedMps: number | null;
  accuracyM: number | null;
};

/** Starts native background tracking. Returns a stop function, or null if unavailable. */
export async function startBackgroundLocation(
  onFix: (fix: BackgroundFix) => void,
  onError: (message: string, needsSettings: boolean) => void,
): Promise<(() => Promise<void>) | null> {
  if (!isBackgroundLocationAvailable()) return null;
  try {
    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: "MOOVU Driver is online",
        backgroundMessage: "Sharing your location so you keep receiving trip requests.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 25,
      },
      (position, error) => {
        if (error) {
          onError(
            error.code === "NOT_AUTHORIZED"
              ? "Location permission is off. Allow location 'all the time' for MOOVU Driver to keep receiving trips."
              : error.message || "Background location error.",
            error.code === "NOT_AUTHORIZED",
          );
          return;
        }
        if (!position) return;
        onFix({
          lat: position.latitude,
          lng: position.longitude,
          heading: position.bearing ?? null,
          speedMps: position.speed ?? null,
          accuracyM: position.accuracy ?? null,
        });
      },
    );
    return async () => {
      await BackgroundGeolocation.removeWatcher({ id }).catch(() => undefined);
    };
  } catch (error) {
    onError(error instanceof Error ? error.message : "Background location could not start.", false);
    return null;
  }
}

export function openLocationSettings() {
  return BackgroundGeolocation.openSettings().catch(() => undefined);
}
