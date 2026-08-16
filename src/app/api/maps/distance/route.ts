import { NextResponse } from "next/server";
import {
  isValidLatitude,
  isValidLongitude,
  type MapRoutePoint,
} from "@/lib/maps/mapRequestPolicy";
import { calculateDrivingRoute } from "@/lib/maps/routeService";
import { createRouteQuote } from "@/lib/maps/routeQuote";
import {
  mapErrorResponse,
  mapsRequestActor,
} from "@/lib/server/mapsCostControl";
import { takeRateLimit } from "@/lib/server/requestControl";

type DistanceBody = {
  origin_place_id?: string;
  destination_place_id?: string;
  origin_lat?: number;
  origin_lng?: number;
  destination_lat?: number;
  destination_lng?: number;
  waypoints?: Array<{ place_id?: string; lat?: number; lng?: number }>;
};

function point(placeId: unknown, lat: unknown, lng: unknown): MapRoutePoint | null {
  const normalizedPlaceId = String(placeId ?? "").trim().slice(0, 180);
  if (normalizedPlaceId) return { placeId: normalizedPlaceId };
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) return null;
  return { lat, lng };
}

export async function POST(req: Request) {
  try {
    const rate = takeRateLimit(req, "maps:distance", { limit: 20, windowMs: 60_000 });
    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many route calculations. Please try again shortly." },
        { status: 429 },
      );
    }

    const body = (await req.json()) as DistanceBody;
    const origin = point(body.origin_place_id, body.origin_lat, body.origin_lng);
    const destination = point(
      body.destination_place_id,
      body.destination_lat,
      body.destination_lng,
    );
    if (!origin || !destination) {
      return NextResponse.json(
        { ok: false, error: "Origin and destination require valid place IDs or coordinates." },
        { status: 400 },
      );
    }

    const waypoints = (body.waypoints ?? [])
      .slice(0, 2)
      .map((waypoint) => point(waypoint.place_id, waypoint.lat, waypoint.lng))
      .filter((value): value is MapRoutePoint => value !== null);

    const route = await calculateDrivingRoute({
      origin,
      destination,
      waypoints,
      actorKey: mapsRequestActor(req, "distance"),
    });
    const routeQuote = createRouteQuote(route);

    return NextResponse.json(
      { ok: true, ...route, routeQuote },
      {
        headers: {
          "Cache-Control": "private, max-age=30",
          "X-MOOVU-Route-Signature": route.routeSignature,
        },
      },
    );
  } catch (error: unknown) {
    const mapped = mapErrorResponse(error);
    console.error("[maps-distance] failed", { reason: mapped.reason, status: mapped.status });
    return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
  }
}
