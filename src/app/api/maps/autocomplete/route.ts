import { NextResponse } from "next/server";
import {
  findKnownPlace,
  googleLocationParam,
  knownPlacePrediction,
  MOOVU_SEARCH_RADIUS_METERS,
} from "@/lib/maps/moovuPlaces";
import { resolveCachedJson, takeRateLimit } from "@/lib/server/requestControl";

type PlacePrediction = {
  description?: string;
  place_id?: string;
};

export async function POST(req: Request) {
  try {
    const rate = takeRateLimit(req, "maps:autocomplete", { limit: 90, windowMs: 60_000 });
    if (!rate.ok) {
      return NextResponse.json({ ok: false, error: "Too many place searches. Please slow down." }, { status: 429 });
    }

    const { input } = await req.json();
    const normalizedInput = String(input ?? "").trim();

    if (!normalizedInput || normalizedInput.length < 3) {
      return NextResponse.json({ ok: true, predictions: [] });
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

    const cacheKey = `maps:autocomplete:${normalizedInput.toLowerCase()}`;
    const { value, cacheStatus } = await resolveCachedJson(cacheKey, 15_000, async () => {
      const url =
        "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
        `?input=${encodeURIComponent(normalizedInput)}` +
        `&components=country:za` +
        `&location=${encodeURIComponent(googleLocationParam())}` +
        `&radius=${MOOVU_SEARCH_RADIUS_METERS}` +
        `&language=en` +
        `&key=${encodeURIComponent(key)}`;

      const resp = await fetch(url, { cache: "no-store" });
      const data = await resp.json();

      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        throw new Error(data.error_message || data.status || "Places autocomplete failed");
      }

      const predictions = ((data.predictions ?? []) as PlacePrediction[]).map((prediction) => ({
        description: prediction.description,
        place_id: prediction.place_id,
      }));

      const knownPlace = findKnownPlace(normalizedInput);
      if (knownPlace) {
        const knownPrediction = knownPlacePrediction(knownPlace);
        const withoutDuplicate = predictions.filter(
          (prediction) => prediction.description !== knownPrediction.description
        );
        return {
          ok: true,
          predictions: [knownPrediction, ...withoutDuplicate].slice(0, 8),
        };
      }

      return { ok: true, predictions };
    });

    return NextResponse.json(value, {
      headers: {
        "Cache-Control": "private, max-age=15",
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
