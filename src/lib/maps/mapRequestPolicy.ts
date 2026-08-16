export const MAP_COORDINATE_PRECISION = 5;

export type MapOperation =
  | "route"
  | "geocode"
  | "reverse_geocode"
  | "autocomplete"
  | "place_details";

export type MapRoutePoint = {
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export const MAP_OPERATION_POLICY: Record<
  MapOperation,
  { ttlMs: number; clientLimitPerMinute: number; globalCircuitPerMinute: number }
> = {
  route: { ttlMs: 3 * 60_000, clientLimitPerMinute: 12, globalCircuitPerMinute: 90 },
  geocode: { ttlMs: 60_000, clientLimitPerMinute: 18, globalCircuitPerMinute: 120 },
  reverse_geocode: { ttlMs: 60_000, clientLimitPerMinute: 18, globalCircuitPerMinute: 120 },
  autocomplete: { ttlMs: 15_000, clientLimitPerMinute: 40, globalCircuitPerMinute: 360 },
  place_details: { ttlMs: 5 * 60_000, clientLimitPerMinute: 24, globalCircuitPerMinute: 180 },
};

export function isMapCircuitLimitReached(operation: MapOperation, callsLastMinute: number) {
  return callsLastMinute >= MAP_OPERATION_POLICY[operation].globalCircuitPerMinute;
}

export function normalizeCoordinate(value: number) {
  if (!Number.isFinite(value)) throw new Error("Map coordinate must be finite.");
  return Number(value.toFixed(MAP_COORDINATE_PRECISION));
}

export function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function normalizeMapText(value: unknown, maxLength = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function routePointSignature(point: MapRoutePoint) {
  const placeId = normalizeMapText(point.placeId, 180);
  if (placeId) return `place:${placeId}`;
  if (!isValidLatitude(point.lat) || !isValidLongitude(point.lng)) {
    throw new Error("Route point requires a valid place ID or coordinates.");
  }
  return `${normalizeCoordinate(point.lat).toFixed(MAP_COORDINATE_PRECISION)},${normalizeCoordinate(point.lng).toFixed(MAP_COORDINATE_PRECISION)}`;
}

export function createRouteSignature(params: {
  origin: MapRoutePoint;
  destination: MapRoutePoint;
  waypoints?: MapRoutePoint[];
  travelMode?: string;
}) {
  const waypoints = (params.waypoints ?? []).map(routePointSignature).join(";");
  const mode = normalizeMapText(params.travelMode || "driving", 24).toLowerCase();
  return `${routePointSignature(params.origin)}|${routePointSignature(params.destination)}|${waypoints}|${mode}`;
}
