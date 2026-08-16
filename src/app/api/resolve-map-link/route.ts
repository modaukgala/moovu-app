import { NextResponse } from "next/server";
import { bestReverseGeocodeLabel, parsePastedLocation } from "@/lib/locationPaste";
import { normalizeCoordinate, normalizeMapText } from "@/lib/maps/mapRequestPolicy";
import {
  getGoogleMapsServerKey,
  mapErrorResponse,
  mapsRequestActor,
  runControlledMapsRequest,
} from "@/lib/server/mapsCostControl";
import { takeRateLimit } from "@/lib/server/requestControl";

async function reverseGeocode(lat: number, lng: number, fallback: string, actorKey: string) {
  const key = getGoogleMapsServerKey();
  if (!key) return null;
  const normalizedLat = normalizeCoordinate(lat);
  const normalizedLng = normalizeCoordinate(lng);
  const { value } = await runControlledMapsRequest({
    operation: "reverse_geocode",
    requestKey: `${normalizedLat}:${normalizedLng}`,
    actorKey,
    loader: async () => {
      const url =
        "https://maps.googleapis.com/maps/api/geocode/json" +
        `?latlng=${encodeURIComponent(`${normalizedLat},${normalizedLng}`)}` +
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
        lat: normalizedLat,
        lng: normalizedLng,
      };

      return { ...payload, label: bestReverseGeocodeLabel(payload, fallback) };
    },
  });
  return value;
}

async function geocodeQuery(query: string, actorKey: string) {
  const key = getGoogleMapsServerKey();
  if (!key) return null;
  const normalizedQuery = normalizeMapText(query).toLowerCase();
  const { value } = await runControlledMapsRequest({
    operation: "geocode",
    requestKey: normalizedQuery,
    actorKey,
    loader: async () => {
      const url =
        "https://maps.googleapis.com/maps/api/geocode/json" +
        `?address=${encodeURIComponent(normalizedQuery)}` +
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
    },
  });
  return value;
}

async function resolvePlaceId(placeId: string, fallback: string, actorKey: string) {
  const key = getGoogleMapsServerKey();
  if (!key) return null;
  const normalizedPlaceId = normalizeMapText(placeId, 180);
  const { value } = await runControlledMapsRequest({
    operation: "place_details",
    requestKey: normalizedPlaceId,
    actorKey,
    loader: async () => {
      const url =
        "https://maps.googleapis.com/maps/api/place/details/json" +
        `?place_id=${encodeURIComponent(normalizedPlaceId)}` +
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
        placeId: result.place_id || normalizedPlaceId,
        globalPlusCode: result.plus_code?.global_code ?? null,
        compoundPlusCode: result.plus_code?.compound_code ?? null,
        formattedAddress: result.formatted_address ?? null,
      };
    },
  });
  return value;
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
    const rate = takeRateLimit(req, "resolve-map-link", { limit: 12, windowMs: 60_000 });
    if (!rate.ok) {
      return NextResponse.json({ ok: false, error: "Too many map-link requests. Please wait and retry." }, { status: 429 });
    }
    const actorKey = mapsRequestActor(req, "resolve-map-link");
    const { input } = (await req.json().catch(() => ({}))) as { input?: string };
    const raw = String(input ?? "").trim().slice(0, 2_000);
    if (!raw) {
      return NextResponse.json({ ok: false, error: "Missing pasted location." }, { status: 400 });
    }

    const direct = parsePastedLocation(raw);
    if (direct.kind === "coordinates") {
      const geo = await reverseGeocode(direct.lat, direct.lng, raw, actorKey);
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
      const place = await resolvePlaceId(direct.placeId, direct.label || raw, actorKey);
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
        const geo = await reverseGeocode(expanded.lat, expanded.lng, raw, actorKey);
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
      const geocoded = await geocodeQuery(query, actorKey);
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
    const mapped = mapErrorResponse(error);
    return NextResponse.json(
      { ok: false, error: mapped.message },
      { status: mapped.status },
    );
  }
}
