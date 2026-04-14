import { NextResponse } from "next/server";

type DistanceBody = {
  origin_place_id?: string;
  destination_place_id?: string;
  origin_lat?: number;
  origin_lng?: number;
  destination_lat?: number;
  destination_lng?: number;
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

    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${encodeURIComponent(origin)}` +
      `&destinations=${encodeURIComponent(destination)}` +
      `&mode=driving` +
      `&language=en` +
      `&region=za` +
      `&key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      return NextResponse.json(
        { ok: false, error: "Failed to fetch distance matrix." },
        { status: 500 }
      );
    }

    if (data.status !== "OK") {
      return NextResponse.json(
        { ok: false, error: data.error_message || data.status || "Distance lookup failed." },
        { status: 400 }
      );
    }

    const element = data?.rows?.[0]?.elements?.[0];

    if (!element || element.status !== "OK") {
      return NextResponse.json(
        {
          ok: false,
          error:
            element?.status === "ZERO_RESULTS"
              ? "No driving route found between the selected locations."
              : "Could not calculate route.",
        },
        { status: 400 }
      );
    }

    const distanceMeters = Number(element?.distance?.value ?? 0);
    const durationSeconds = Number(element?.duration?.value ?? 0);

    const distanceKm = distanceMeters / 1000;
    const durationMin = durationSeconds / 60;

    return NextResponse.json({
      ok: true,
      distanceMeters,
      durationSeconds,
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMin: Math.ceil(durationMin),
      originAddress: data?.origin_addresses?.[0] ?? null,
      destinationAddress: data?.destination_addresses?.[0] ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}