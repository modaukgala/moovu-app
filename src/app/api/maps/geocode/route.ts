import { NextResponse } from "next/server";
import {
  findKnownPlace,
  googleBoundsParam,
  localizedSearchQueries,
} from "@/lib/maps/moovuPlaces";
import { resolveCachedJson, takeRateLimit } from "@/lib/server/requestControl";

export async function POST(req: Request) {
  try {
    const rate = takeRateLimit(req, "maps:geocode", { limit: 50, windowMs: 60_000 });
    if (!rate.ok) {
      return NextResponse.json({ ok: false, error: "Too many location lookups. Please slow down." }, { status: 429 });
    }

    const { place } = await req.json();
    const normalizedPlace = String(place ?? "").trim();

    if (!normalizedPlace) {
      return NextResponse.json(
        { ok: false, error: "Missing place name" },
        { status: 400 }
      );
    }

    const knownPlace = findKnownPlace(normalizedPlace);
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

    const cacheKey = `maps:geocode:${normalizedPlace.toLowerCase()}`;
    const { value, cacheStatus } = await resolveCachedJson(cacheKey, 60_000, async () => {
      let result = null;
      let lastStatus = "";

      for (const query of localizedSearchQueries(normalizedPlace)) {
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
        throw new Error(lastStatus === "ZERO_RESULTS" ? "Location not found" : lastStatus || "Location not found");
      }

      return {
        ok: true,
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        address: result.formatted_address,
        formattedAddress: result.formatted_address,
        placeId: result.place_id,
        globalPlusCode: result.plus_code?.global_code ?? null,
        compoundPlusCode: result.plus_code?.compound_code ?? null,
      };
    });

    return NextResponse.json(value, {
      headers: {
        "Cache-Control": "private, max-age=60",
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
