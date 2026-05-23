import { NextResponse } from "next/server";

type DistanceBody = {
  origin_place_id?: string;
  destination_place_id?: string;
  origin_lat?: number;
  origin_lng?: number;
  destination_lat?: number;
  destination_lng?: number;
  waypoints?: Array<{
    place_id?: string;
    lat?: number;
    lng?: number;
  }>;
};

function isValidNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function buildLocationParam(params: {
  placeId?: string;
  lat?: number;
  lng?: number;
}) {
  const placeId = String(params.placeId ?? "").trim();

  if (placeId) {
    return `place_id:${placeId}`;
  }

  if (isValidNumber(params.lat) && isValidNumber(params.lng)) {
    return `${params.lat},${params.lng}`;
  }

  return "";
}

async function fetchDistanceLeg(params: {
  apiKey: string;
  origin: string;
  destination: string;
}) {
  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json` +
    `?origins=${encodeURIComponent(params.origin)}` +
    `&destinations=${encodeURIComponent(params.destination)}` +
    `&mode=driving` +
    `&language=en` +
    `&region=za` +
    `&key=${encodeURIComponent(params.apiKey)}`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data) {
    throw new Error("Failed to fetch distance matrix.");
  }

  if (data.status !== "OK") {
    throw new Error(data.error_message || data.status || "Distance lookup failed.");
  }

  const element = data?.rows?.[0]?.elements?.[0];

  if (!element || element.status !== "OK") {
    throw new Error(
      element?.status === "ZERO_RESULTS"
        ? "No driving route found between the selected locations."
        : "Could not calculate route."
    );
  }

  const distanceMeters = Number(element?.distance?.value ?? 0);
  const durationSeconds = Number(element?.duration?.value ?? 0);

  return {
    distanceMeters,
    durationSeconds,
    originAddress: data?.origin_addresses?.[0] ?? null,
    destinationAddress: data?.destination_addresses?.[0] ?? null,
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as DistanceBody;

    const origin = buildLocationParam({
      placeId: body.origin_place_id,
      lat: body.origin_lat,
      lng: body.origin_lng,
    });

    const destination = buildLocationParam({
      placeId: body.destination_place_id,
      lat: body.destination_lat,
      lng: body.destination_lng,
    });

    if (!origin || !destination) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Origin and destination are required. Use either place IDs or latitude/longitude coordinates.",
        },
        { status: 400 }
      );
    }

    const apiKey =
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
      "";

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Google Maps API key is missing." },
        { status: 500 }
      );
    }

    const waypointParams = (body.waypoints ?? [])
      .slice(0, 2)
      .map((waypoint) =>
        buildLocationParam({
          placeId: waypoint.place_id,
          lat: waypoint.lat,
          lng: waypoint.lng,
        })
      )
      .filter(Boolean);

    const directLeg = await fetchDistanceLeg({ apiKey, origin, destination });
    let routeDistanceMeters = directLeg.distanceMeters;
    let routeDurationSeconds = directLeg.durationSeconds;

    if (waypointParams.length > 0) {
      routeDistanceMeters = 0;
      routeDurationSeconds = 0;
      const orderedPoints = [origin, ...waypointParams, destination];

      for (let i = 0; i < orderedPoints.length - 1; i += 1) {
        const leg = await fetchDistanceLeg({
          apiKey,
          origin: orderedPoints[i],
          destination: orderedPoints[i + 1],
        });
        routeDistanceMeters += leg.distanceMeters;
        routeDurationSeconds += leg.durationSeconds;
      }
    }

    const distanceKm = routeDistanceMeters / 1000;
    const durationMin = routeDurationSeconds / 60;
    const originalDistanceKm = directLeg.distanceMeters / 1000;
    const originalDurationMin = directLeg.durationSeconds / 60;

    return NextResponse.json({
      ok: true,
      distanceMeters: routeDistanceMeters,
      durationSeconds: routeDurationSeconds,
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMin: Math.ceil(durationMin),
      originalDistanceMeters: directLeg.distanceMeters,
      originalDurationSeconds: directLeg.durationSeconds,
      originalDistanceKm: Number(originalDistanceKm.toFixed(2)),
      originalDurationMin: Math.ceil(originalDurationMin),
      extraDistanceKm: Number(Math.max(0, distanceKm - originalDistanceKm).toFixed(2)),
      extraDurationMin: Math.max(0, Math.ceil(durationMin) - Math.ceil(originalDurationMin)),
      stopCount: waypointParams.length,
      originAddress: directLeg.originAddress,
      destinationAddress: directLeg.destinationAddress,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
