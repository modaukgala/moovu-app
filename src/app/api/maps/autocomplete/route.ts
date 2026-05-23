import { NextResponse } from "next/server";
import {
  findKnownPlace,
  googleLocationParam,
  knownPlacePrediction,
  MOOVU_SEARCH_RADIUS_METERS,
} from "@/lib/maps/moovuPlaces";

type PlacePrediction = {
  description?: string;
  place_id?: string;
};

export async function POST(req: Request) {
  try {
    const { input } = await req.json();

    if (!input || String(input).trim().length < 3) {
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

    const url =
      "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
      `?input=${encodeURIComponent(input)}` +
      `&components=country:za` +
      `&location=${encodeURIComponent(googleLocationParam())}` +
      `&radius=${MOOVU_SEARCH_RADIUS_METERS}` +
      `&language=en` +
      `&key=${encodeURIComponent(key)}`;

    const resp = await fetch(url, { cache: "no-store" });
    const data = await resp.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return NextResponse.json(
        {
          ok: false,
          error: "Places autocomplete failed",
          status: data.status,
          message: data.error_message,
        },
        { status: 400 }
      );
    }

    const predictions = ((data.predictions ?? []) as PlacePrediction[]).map((prediction) => ({
      description: prediction.description,
      place_id: prediction.place_id,
    }));

    const knownPlace = findKnownPlace(String(input));
    if (knownPlace) {
      const knownPrediction = knownPlacePrediction(knownPlace);
      const withoutDuplicate = predictions.filter(
        (prediction) => prediction.description !== knownPrediction.description
      );
      return NextResponse.json({
        ok: true,
        predictions: [knownPrediction, ...withoutDuplicate].slice(0, 8),
      });
    }

    return NextResponse.json({ ok: true, predictions });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
