import { NextResponse } from "next/server";
import {
  findKnownPlace,
  googleBoundsParam,
  localizedSearchQueries,
} from "@/lib/maps/moovuPlaces";

export async function POST(req: Request) {
  try {
    const { place } = await req.json();

    if (!place) {
      return NextResponse.json(
        { ok: false, error: "Missing place name" },
        { status: 400 }
      );
    }

    const knownPlace = findKnownPlace(String(place));
    if (knownPlace) {
      return NextResponse.json({
        ok: true,
        lat: knownPlace.lat,
        lng: knownPlace.lng,
        address: knownPlace.formattedAddress,
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

    let result = null;
    let lastStatus = "";

    for (const query of localizedSearchQueries(String(place))) {
      const url =
        "https://maps.googleapis.com/maps/api/geocode/json" +
        `?address=${encodeURIComponent(query)}` +
        `&components=country:ZA` +
        `&bounds=${encodeURIComponent(googleBoundsParam())}` +
        `&region=za` +
        `&key=${encodeURIComponent(key)}`;

      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      lastStatus = data.status;

      if (data.status === "OK" && data.results?.length) {
        result = data.results[0];
        break;
      }
    }

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "Location not found", status: lastStatus },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      address: result.formatted_address,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
