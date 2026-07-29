"use client";

import { Camera } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

type MoovuPosition = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };
};

type PositionOptions = {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
};

export type MoovuPositionWatcher = {
  stop: () => Promise<void>;
};

function createGeolocationError(code: number, message: string): GeolocationPositionError {
  return {
    code,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

function hasLocationPermission(permissions: { location?: string; coarseLocation?: string }) {
  return permissions.location === "granted" || permissions.coarseLocation === "granted";
}

export async function getMoovuCurrentPosition(options: PositionOptions = {}): Promise<MoovuPosition> {
  if (Capacitor.isNativePlatform()) {
    let currentPermission: { location?: string; coarseLocation?: string };

    try {
      currentPermission = await Geolocation.checkPermissions();
    } catch {
      throw createGeolocationError(
        2,
        "MOOVU could not check location access. Make sure location permission is configured for this app.",
      );
    }

    let locationAllowed = hasLocationPermission(currentPermission);

    if (!locationAllowed) {
      try {
        const requestedPermission = await Geolocation.requestPermissions({
          permissions: ["location"],
        });
        locationAllowed = hasLocationPermission(requestedPermission);
      } catch {
        throw createGeolocationError(
          1,
          "Location permission was not granted. Allow location access for MOOVU in your phone settings, then retry.",
        );
      }
    }

    if (!locationAllowed) {
      throw createGeolocationError(
        1,
        "Location permission is blocked. Allow location access for MOOVU in your phone app settings.",
      );
    }

    let position: Awaited<ReturnType<typeof Geolocation.getCurrentPosition>>;

    try {
      position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: options.enableHighAccuracy ?? true,
        timeout: options.timeout ?? 15000,
        maximumAge: options.maximumAge ?? 0,
      });
    } catch {
      throw createGeolocationError(
        2,
        "MOOVU could not get your current location. Check GPS, allow precise location, then retry.",
      );
    }

    return {
      coords: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      },
    };
  }

  if (typeof window === "undefined" || !navigator.geolocation) {
    throw createGeolocationError(2, "This device does not support location.");
  }

  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

export async function watchMoovuPosition(params: {
  options?: PositionOptions;
  onPosition: (position: MoovuPosition) => void;
  onError?: (error: GeolocationPositionError) => void;
}): Promise<MoovuPositionWatcher> {
  const options = params.options ?? {};

  if (Capacitor.isNativePlatform()) {
    await getMoovuCurrentPosition(options);
    const callbackId = await Geolocation.watchPosition(
      {
        enableHighAccuracy: options.enableHighAccuracy ?? true,
        timeout: options.timeout ?? 15000,
        maximumAge: options.maximumAge ?? 0,
        minimumUpdateInterval: 1000,
      },
      (position, error) => {
        if (error) {
          params.onError?.(createGeolocationError(error.code ?? 2, error.message));
          return;
        }
        if (!position) return;
        params.onPosition({
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
        });
      },
    );
    return {
      stop: async () => {
        await Geolocation.clearWatch({ id: callbackId });
      },
    };
  }

  if (typeof window === "undefined" || !navigator.geolocation) {
    throw createGeolocationError(2, "This device does not support location.");
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) => params.onPosition(position),
    (error) => params.onError?.(error),
    options,
  );
  return {
    stop: async () => {
      navigator.geolocation.clearWatch(watchId);
    },
  };
}

export async function requestNativeCameraPermissions() {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  const currentPermission = await Camera.checkPermissions();
  const photosAllowed = currentPermission.photos === "granted" || currentPermission.photos === "limited";

  if (currentPermission.camera === "granted" && photosAllowed) {
    return;
  }

  await Camera.requestPermissions({ permissions: ["camera", "photos"] });
}
