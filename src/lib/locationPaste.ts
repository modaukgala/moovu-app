export type ParsedPastedLocation =
  | {
      kind: "coordinates";
      lat: number;
      lng: number;
      source: "coordinates" | "google-url" | "apple-url" | "url" | "text";
      raw: string;
    }
  | {
      kind: "plus_code";
      plusCode: string;
      raw: string;
    }
  | {
      kind: "place_id";
      placeId: string;
      label?: string;
      raw: string;
    }
  | {
      kind: "text";
      query: string;
      raw: string;
    }
  | {
      kind: "empty";
      raw: string;
    };

export type ReverseGeocodeResult = {
  ok: boolean;
  label?: string;
  address?: string;
  formattedAddress?: string;
  globalPlusCode?: string;
  compoundPlusCode?: string;
  placeId?: string;
  name?: string;
  lat?: number;
  lng?: number;
  error?: string;
};

const COORD_PATTERN =
  /(?:^|[^\d.-])(-?\d{1,2}(?:\.\d{3,})?)\s*,\s*(-?\d{1,3}(?:\.\d{3,})?)(?=$|[^\d.])/;
const PLUS_CODE_PATTERN =
  /\b(?:[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}|[23456789CFGHJMPQRVWX]{2,4}\+[23456789CFGHJMPQRVWX]{2,3})\b(?:\s+[^,\n\r]+)?/i;

function validLatLng(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function parseLatLngPair(value: string): { lat: number; lng: number } | null {
  const match = value.match(COORD_PATTERN);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return validLatLng(lat, lng) ? { lat, lng } : null;
}

function decode(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function extractUrl(input: string) {
  const match = input.match(/https?:\/\/[^\s<>"']+/i);
  return match?.[0]?.trim() ?? "";
}

function parseUrlCoordinates(urlText: string): ParsedPastedLocation | null {
  try {
    const url = new URL(urlText);
    const host = url.hostname.toLowerCase();
    const source = host.includes("apple.com")
      ? "apple-url"
      : host.includes("google.") || host.includes("goo.gl") || host.includes("maps.app")
        ? "google-url"
        : "url";

    const params = url.searchParams;
    const paramCandidates = [
      params.get("ll"),
      params.get("q"),
      params.get("query"),
      params.get("center"),
      params.get("daddr"),
      params.get("saddr"),
      params.get("destination"),
    ]
      .filter((value): value is string => Boolean(value))
      .map(decode);

    for (const candidate of paramCandidates) {
      const coords = parseLatLngPair(candidate);
      if (coords) return { kind: "coordinates", ...coords, source, raw: urlText };
    }

    const atCoords = urlText.match(/@(-?\d{1,2}(?:\.\d{3,})?),\s*(-?\d{1,3}(?:\.\d{3,})?)(?:[,/]|$)/);
    if (atCoords) {
      const lat = Number(atCoords[1]);
      const lng = Number(atCoords[2]);
      if (validLatLng(lat, lng)) return { kind: "coordinates", lat, lng, source, raw: urlText };
    }

    const pathCoords = parseLatLngPair(decode(url.pathname));
    if (pathCoords) return { kind: "coordinates", ...pathCoords, source, raw: urlText };

    const placeId = params.get("query_place_id") || params.get("place_id");
    if (placeId) {
      return {
        kind: "place_id",
        placeId,
        label: params.get("q") ? decode(params.get("q") || "") : undefined,
        raw: urlText,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function parsePastedLocation(input: string): ParsedPastedLocation {
  const raw = input.trim();
  if (!raw) return { kind: "empty", raw };

  const urlText = extractUrl(raw);
  if (urlText) {
    const parsedUrl = parseUrlCoordinates(urlText);
    if (parsedUrl) return parsedUrl;
  }

  const directCoords = parseLatLngPair(raw);
  if (directCoords) {
    return { kind: "coordinates", ...directCoords, source: urlText ? "url" : "text", raw };
  }

  const plusCodeMatch = raw.match(PLUS_CODE_PATTERN);
  if (plusCodeMatch?.[0]) {
    return { kind: "plus_code", plusCode: plusCodeMatch[0].trim(), raw };
  }

  return { kind: "text", query: urlText || raw, raw };
}

export function bestReverseGeocodeLabel(result: ReverseGeocodeResult, fallback: string) {
  return (
    result.compoundPlusCode?.trim() ||
    result.globalPlusCode?.trim() ||
    result.formattedAddress?.trim() ||
    result.address?.trim() ||
    result.name?.trim() ||
    fallback.trim()
  );
}

