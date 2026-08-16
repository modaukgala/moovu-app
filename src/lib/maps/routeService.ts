import {
  createRouteSignature,
  isValidLatitude,
  isValidLongitude,
  normalizeCoordinate,
  routePointSignature,
  type MapRoutePoint,
} from "@/lib/maps/mapRequestPolicy";
import {
  getGoogleMapsServerKey,
  runControlledMapsRequest,
} from "@/lib/server/mapsCostControl";
import { resolveCachedJson } from "@/lib/server/requestControl";

export type DrivingRouteResult = {
  routeSignature: string;
  distanceMeters: number;
  durationSeconds: number;
  distanceKm: number;
  durationMin: number;
  originalDistanceMeters: number;
  originalDurationSeconds: number;
  originalDistanceKm: number;
  originalDurationMin: number;
  extraDistanceKm: number;
  extraDurationMin: number;
  stopCount: number;
  originAddress: string | null;
  destinationAddress: string | null;
};

function locationParam(point: MapRoutePoint) {
  const placeId = String(point.placeId ?? "").trim();
  if (placeId) return `place_id:${placeId}`;
  if (!isValidLatitude(point.lat) || !isValidLongitude(point.lng)) {
    throw new Error("Origin and destination require valid coordinates or place IDs.");
  }
  return `${normalizeCoordinate(point.lat)},${normalizeCoordinate(point.lng)}`;
}

async function fetchDistanceLeg(params: {
  apiKey: string;
  origin: MapRoutePoint;
  destination: MapRoutePoint;
  actorKey?: string;
}) {
  const origin = locationParam(params.origin);
  const destination = locationParam(params.destination);
  const legKey = `${routePointSignature(params.origin)}|${routePointSignature(params.destination)}|driving`;

  const { value } = await runControlledMapsRequest({
    operation: "route",
    requestKey: legKey,
    actorKey: params.actorKey,
    loader: async () => {
      const url =
        "https://maps.googleapis.com/maps/api/distancematrix/json" +
        `?origins=${encodeURIComponent(origin)}` +
        `&destinations=${encodeURIComponent(destination)}` +
        "&mode=driving&language=en&region=za" +
        `&key=${encodeURIComponent(params.apiKey)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9_000);
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const data = await response.json().catch(() => null);
        const element = data?.rows?.[0]?.elements?.[0];
        if (!response.ok || data?.status !== "OK" || !element || element.status !== "OK") {
          throw new Error(
            element?.status === "ZERO_RESULTS"
              ? "No driving route found between the selected locations."
              : data?.error_message || data?.status || "Could not calculate route.",
          );
        }
        return {
          distanceMeters: Number(element.distance?.value ?? 0),
          durationSeconds: Number(element.duration?.value ?? 0),
          originAddress: String(data?.origin_addresses?.[0] ?? "") || null,
          destinationAddress: String(data?.destination_addresses?.[0] ?? "") || null,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  });
  return value;
}
export async function calculateDrivingRoute(params: {
  origin: MapRoutePoint;
  destination: MapRoutePoint;
  waypoints?: MapRoutePoint[];
  actorKey?: string;
}): Promise<DrivingRouteResult> {
  const apiKey = getGoogleMapsServerKey();
  if (!apiKey) throw new Error("Google Maps server API key is missing.");
  const waypoints = (params.waypoints ?? []).slice(0, 2);
  const routeSignature = createRouteSignature({
    origin: params.origin,
    destination: params.destination,
    waypoints,
    travelMode: "driving",
  });

  const { value } = await resolveCachedJson(`maps:route-plan:${routeSignature}`, 3 * 60_000, async () => {
    const original = await fetchDistanceLeg({
      apiKey,
      origin: params.origin,
      destination: params.destination,
      actorKey: params.actorKey,
    });

    let distanceMeters = original.distanceMeters;
    let durationSeconds = original.durationSeconds;
    if (waypoints.length > 0) {
      distanceMeters = 0;
      durationSeconds = 0;
      const points = [params.origin, ...waypoints, params.destination];
      for (let index = 0; index < points.length - 1; index += 1) {
        const leg = await fetchDistanceLeg({
          apiKey,
          origin: points[index],
          destination: points[index + 1],
          actorKey: params.actorKey,
        });
        distanceMeters += leg.distanceMeters;
        durationSeconds += leg.durationSeconds;
      }
    }

    const distanceKm = distanceMeters / 1000;
    const durationMin = durationSeconds / 60;
    const originalDistanceKm = original.distanceMeters / 1000;
    const originalDurationMin = original.durationSeconds / 60;
    return {
      routeSignature,
      distanceMeters,
      durationSeconds,
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMin: Math.ceil(durationMin),
      originalDistanceMeters: original.distanceMeters,
      originalDurationSeconds: original.durationSeconds,
      originalDistanceKm: Number(originalDistanceKm.toFixed(2)),
      originalDurationMin: Math.ceil(originalDurationMin),
      extraDistanceKm: Number(Math.max(0, distanceKm - originalDistanceKm).toFixed(2)),
      extraDurationMin: Math.max(0, Math.ceil(durationMin) - Math.ceil(originalDurationMin)),
      stopCount: waypoints.length,
      originAddress: original.originAddress,
      destinationAddress: original.destinationAddress,
    };
  });

  return value;
}
