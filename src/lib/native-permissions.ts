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
