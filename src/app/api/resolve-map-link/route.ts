import { NextResponse } from "next/server";
import { bestReverseGeocodeLabel, parsePastedLocation } from "@/lib/locationPaste";

async function reverseGeocode(lat: number, lng: number, fallback: string) {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const url =
    "https://maps.googleapis.com/maps/api/geocode/json" +
    `?latlng=${encodeURIComponent(`${lat},${lng}`)}` +
    `&key=${encodeURIComponent(key)}`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (data?.status !== "OK" || !data.results?.length) return null;

  const result = data.results[0];
  const payload = {
    ok: true,
    formattedAddress: result.formatted_address as string | undefined,
    address: result.formatted_address as string | undefined,
    placeId: result.place_id as string | undefined,
    globalPlusCode: data.plus_code?.global_code ?? result.plus_code?.global_code ?? undefined,
    compoundPlusCode: data.plus_code?.compound_code ?? result.plus_code?.compound_code ?? undefined,
    lat,
    lng,
  };

  return {
    ...payload,
    label: bestReverseGeocodeLabel(payload, fallback),
  };
}

async function geocodeQuery(query: string) {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const url =
    "https://maps.googleapis.com/maps/api/geocode/json" +
    `?address=${encodeURIComponent(query)}` +
    `&region=za` +
    `&key=${encodeURIComponent(key)}`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (data?.status !== "OK" || !data.results?.length) return null;

  const result = data.results[0];
  const lat = result.geometry.location.lat;
  const lng = result.geometry.location.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  return {
    label: result.plus_code?.compound_code || result.plus_code?.global_code || result.formatted_address || query,
    lat,
    lng,
    placeId: result.place_id || "",
    globalPlusCode: result.plus_code?.global_code ?? null,
    compoundPlusCode: result.plus_code?.compound_code ?? null,
    formattedAddress: result.formatted_address ?? null,
  };
}

async function resolvePlaceId(placeId: string, fallback: string) {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const url =
    "https://maps.googleapis.com/maps/api/place/details/json" +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&fields=formatted_address,name,place_id,geometry/location,plus_code` +
    `&language=en` +
    `&key=${encodeURIComponent(key)}`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (data?.status !== "OK" || !data.result?.geometry?.location) return null;

  const result = data.result;
  const lat = result.geometry.location.lat;
  const lng = result.geometry.location.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  return {
    label: result.plus_code?.compound_code || result.plus_code?.global_code || result.name || result.formatted_address || fallback,
    lat,
    lng,
    placeId: result.place_id || placeId,
    globalPlusCode: result.plus_code?.global_code ?? null,
    compoundPlusCode: result.plus_code?.compound_code ?? null,
    formattedAddress: result.formatted_address ?? null,
  };
}

async function expandUrl(input: string) {
  const firstUrl = input.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  if (!firstUrl) return null;

  try {
    const response = await fetch(firstUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": "MOOVU-Rides/1.0 (+https://moovurides.co.za)",
      },
    });
    return response.url || firstUrl;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { input } = (await req.json().catch(() => ({}))) as { input?: string };
    const raw = String(input ?? "").trim();
    if (!raw) {
      return NextResponse.json({ ok: false, error: "Missing pasted location." }, { status: 400 });
    }

    const direct = parsePastedLocation(raw);
    if (direct.kind === "coordinates") {
      const geo = await reverseGeocode(direct.lat, direct.lng, raw);
      return NextResponse.json({
        ok: true,
        expandedUrl: null,
        parsed: direct,
        location: {
          label: geo?.label ?? `${direct.lat.toFixed(5)}, ${direct.lng.toFixed(5)}`,
          lat: direct.lat,
          lng: direct.lng,
          placeId: geo?.placeId ?? "",
          source: "pasted-location",
          globalPlusCode: geo?.globalPlusCode ?? null,
          compoundPlusCode: geo?.compoundPlusCode ?? null,
          formattedAddress: geo?.formattedAddress ?? null,
        },
      });
    }

    if (direct.kind === "place_id") {
      const place = await resolvePlaceId(direct.placeId, direct.label || raw);
      if (place) {
        return NextResponse.json({
          ok: true,
          expandedUrl: null,
          parsed: direct,
          location: {
            ...place,
            source: "pasted-location",
          },
        });
      }
    }

    const expandedUrl = await expandUrl(raw);
    if (expandedUrl && expandedUrl !== raw) {
      const expanded = parsePastedLocation(expandedUrl);
      if (expanded.kind === "coordinates") {
        const geo = await reverseGeocode(expanded.lat, expanded.lng, raw);
        return NextResponse.json({
          ok: true,
          expandedUrl,
          parsed: expanded,
          location: {
            label: geo?.label ?? `${expanded.lat.toFixed(5)}, ${expanded.lng.toFixed(5)}`,
            lat: expanded.lat,
            lng: expanded.lng,
            placeId: geo?.placeId ?? "",
            source: "pasted-location",
            globalPlusCode: geo?.globalPlusCode ?? null,
            compoundPlusCode: geo?.compoundPlusCode ?? null,
            formattedAddress: geo?.formattedAddress ?? null,
          },
        });
      }
    }

    if (direct.kind === "plus_code" || (direct.kind === "text" && !raw.includes("maps.app.goo.gl"))) {
      const query = direct.kind === "plus_code" ? direct.plusCode : direct.query;
      const geocoded = await geocodeQuery(query);
      if (geocoded) {
        return NextResponse.json({
          ok: true,
          expandedUrl,
          parsed: direct,
          location: {
            ...geocoded,
            source: "pasted-location",
          },
        });
      }
    }

    return NextResponse.json({
      ok: false,
      expandedUrl,
      parsed: direct,
      error:
        direct.kind === "text" && raw.includes("maps.app.goo.gl")
          ? "We could not read this short map link. Please open it, copy the full address or coordinates, and paste again."
          : "We couldn't identify that location. Try pasting coordinates, a full Google Maps link, or a Plus Code.",
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 },
    );
  }
}
