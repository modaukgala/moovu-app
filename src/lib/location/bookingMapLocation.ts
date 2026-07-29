export type MapLocation = {
  lat: number;
  lng: number;
};

export type SessionMapLocation = MapLocation & {
  capturedAt: number;
};

export type MapPickerLocationSource =
  | "confirmed_pickup"
  | "confirmed_destination"
  | "live_gps"
  | "session_location"
  | "operating_area";

export type MapPickerInitialLocation = {
  location: MapLocation | null;
  source: MapPickerLocationSource;
};

const LIVE_LOCATION_MAX_AGE_MS = 2 * 60 * 1000;
const SESSION_LOCATION_MAX_AGE_MS = 30 * 60 * 1000;

export function isValidMapLocation(
  location: MapLocation | null | undefined,
): location is MapLocation {
  return (
    !!location &&
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lng) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    location.lng >= -180 &&
    location.lng <= 180
  );
}

export function isRecentSessionLocation(
  location: SessionMapLocation | null | undefined,
  maxAgeMs: number,
  now = Date.now(),
): location is SessionMapLocation {
  return (
    isValidMapLocation(location) &&
    Number.isFinite(location.capturedAt) &&
    location.capturedAt <= now + 10_000 &&
    now - location.capturedAt <= maxAgeMs
  );
}

export function selectMapPickerInitialLocation(params: {
  kind: "pickup" | "dropoff";
  pickup: MapLocation | null;
  destination: MapLocation | null;
  sessionLocation: SessionMapLocation | null;
  now?: number;
}): MapPickerInitialLocation {
  const now = params.now ?? Date.now();

  if (params.kind === "pickup" && isValidMapLocation(params.pickup)) {
    return { location: params.pickup, source: "confirmed_pickup" };
  }

  if (params.kind === "dropoff") {
    if (isValidMapLocation(params.destination)) {
      return { location: params.destination, source: "confirmed_destination" };
    }
    if (isValidMapLocation(params.pickup)) {
      return { location: params.pickup, source: "confirmed_pickup" };
    }
  }

  if (isRecentSessionLocation(params.sessionLocation, LIVE_LOCATION_MAX_AGE_MS, now)) {
    return { location: params.sessionLocation, source: "live_gps" };
  }

  if (
    params.kind === "pickup" &&
    isRecentSessionLocation(params.sessionLocation, SESSION_LOCATION_MAX_AGE_MS, now)
  ) {
    return { location: params.sessionLocation, source: "session_location" };
  }

  return { location: null, source: "operating_area" };
}

export function isFreshLiveLocation(
  location: SessionMapLocation | null | undefined,
  now = Date.now(),
) {
  return isRecentSessionLocation(location, LIVE_LOCATION_MAX_AGE_MS, now);
}
