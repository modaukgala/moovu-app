import { NextResponse } from "next/server";
import { knownPlaceFromSyntheticId } from "@/lib/maps/moovuPlaces";
import { resolveCachedJson, takeRateLimit } from "@/lib/server/requestControl";

export async function POST(req: Request) {
  try {
    const rate = takeRateLimit(req, "maps:place-details", { limit: 60, windowMs: 60_000 });
    if (!rate.ok) {
      return NextResponse.json({ ok: false, error: "Too many place lookups. Please slow down." }, { status: 429 });
    }

    const { place_id } = await req.json();

    if (!place_id) {
      return NextResponse.json({ ok: false, error: "Missing place_id" }, { status: 400 });
    }

    const knownPlace = knownPlaceFromSyntheticId(String(place_id));
    if (knownPlace) {
      return NextResponse.json({
        ok: true,
        place_id,
        formatted_address: knownPlace.formattedAddress,
        name: knownPlace.name,
        lat: knownPlace.lat,
        lng: knownPlace.lng,
      });
    }

    const key =
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    if (!key) {
      return NextResponse.json(
        { ok: false, error: "Missing Google Maps API key." },
        { status: 500 }
      );
    }

    const cacheKey = `maps:place-details:${String(place_id).trim()}`;
    const { value, cacheStatus } = await resolveCachedJson(cacheKey, 300_000, async () => {
      const url =
        "https://maps.googleapis.com/maps/api/place/details/json" +
        `?place_id=${encodeURIComponent(place_id)}` +
        `&fields=formatted_address,name,place_id,geometry/location` +
        `&language=en` +
        `&key=${encodeURIComponent(key)}`;

      const resp = await fetch(url, { cache: "no-store" });
      const data = await resp.json();

      if (data.status !== "OK") {
        throw new Error(data.error_message || data.status || "Place details failed");
      }

      const result = data.result;

      return {
        ok: true,
        place_id: result.place_id,
        formatted_address: result.formatted_address ?? result.name,
        name: result.name,
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
      };
    });

    return NextResponse.json(value, {
      headers: {
        "Cache-Control": "private, max-age=300",
        "X-MOOVU-Cache": cacheStatus,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
