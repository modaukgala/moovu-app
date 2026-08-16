import { NextResponse } from "next/server";
import { takeRateLimit } from "@/lib/server/requestControl";
import {
  getGoogleMapsServerKey,
  mapErrorResponse,
  mapsRequestActor,
  runControlledMapsRequest,
} from "@/lib/server/mapsCostControl";
import { isValidLatitude, isValidLongitude, normalizeCoordinate } from "@/lib/maps/mapRequestPolicy";

type AddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GeocodeResult = {
  formatted_address?: string;
  place_id?: string;
  plus_code?: { global_code?: string };
  types?: string[];
  address_components?: AddressComponent[];
};

const USEFUL_RESULT_TYPES = [
  "establishment",
  "point_of_interest",
  "premise",
  "school",
  "hospital",
  "store",
] as const;

function hasType(result: GeocodeResult, type: string) {
  return result.types?.includes(type) ?? false;
}

function addressPart(result: GeocodeResult, types: string[]) {
  const component = result.address_components?.find((item) =>
    item.types?.some((type) => types.includes(type))
  );
  return component?.long_name?.trim() || component?.short_name?.trim() || "";
}

function usefulLocationLabel(results: GeocodeResult[]) {
  const landmark = results.find((result) =>
    USEFUL_RESULT_TYPES.some((type) => hasType(result, type))
  );
  if (landmark?.formatted_address) return landmark.formatted_address;

  const first = results[0];
  const route = addressPart(first, ["route"]);
  const suburb = addressPart(first, ["sublocality", "sublocality_level_1", "neighborhood"]);
  const locality = addressPart(first, ["locality", "postal_town", "administrative_area_level_3"]);
  const usefulParts = [route, suburb, locality].filter(Boolean);

  return usefulParts.length > 0
    ? usefulParts.filter((part, index) => usefulParts.indexOf(part) === index).join(", ")
    : first.formatted_address || "";
}

export async function POST(req: Request) {
  try {
    const rate = takeRateLimit(req, "maps:reverse-geocode", { limit: 60, windowMs: 60_000 });
    if (!rate.ok) {
      return NextResponse.json({ ok: false, error: "Too many location lookups. Please slow down." }, { status: 429 });
    }

    const { lat, lng } = await req.json();

    if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
      return NextResponse.json({ ok: false, error: "lat/lng must be numbers" }, { status: 400 });
    }

    const key = getGoogleMapsServerKey();
    if (!key) {
      return NextResponse.json({ ok: false, error: "Missing Google Maps API key" }, { status: 500 });
    }

    const normalizedLat = normalizeCoordinate(lat);
    const normalizedLng = normalizeCoordinate(lng);
    const { value, cacheStatus } = await runControlledMapsRequest({
      operation: "reverse_geocode",
      requestKey: `${normalizedLat}:${normalizedLng}`,
      actorKey: mapsRequestActor(req, "reverse-geocode"),
      loader: async () => {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(
          `${normalizedLat},${normalizedLng}`
        )}&key=${encodeURIComponent(key)}`;

      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();

      if (data.status !== "OK" || !data.results?.length) {
        throw new Error("Could not reverse geocode location");
      }

      const results = data.results as GeocodeResult[];
      const primaryResult = results[0];
      const label = usefulLocationLabel(results);

      return {
        ok: true,
        label,
        address: label || primaryResult.formatted_address,
        formattedAddress: label || primaryResult.formatted_address,
        placeId: primaryResult.place_id,
        globalPlusCode: data.plus_code?.global_code ?? primaryResult.plus_code?.global_code ?? null,
        compoundPlusCode: data.plus_code?.compound_code ?? null,
        lat: normalizedLat,
        lng: normalizedLng,
      };
      },
    });

    return NextResponse.json(value, {
      headers: {
        "Cache-Control": "private, max-age=60",
        "X-MOOVU-Cache": cacheStatus,
      },
    });
  } catch (error: unknown) {
    const mapped = mapErrorResponse(error);
    return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
  }
}
