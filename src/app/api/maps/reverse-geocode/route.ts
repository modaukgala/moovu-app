import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { lat, lng } = await req.json();

    if (typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ ok: false, error: "lat/lng must be numbers" }, { status: 400 });
    }

    const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) {
      return NextResponse.json({ ok: false, error: "Missing Google Maps API key" }, { status: 500 });
    }

    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(
        `${lat},${lng}`
      )}&key=${encodeURIComponent(key)}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "OK" || !data.results?.length) {
      return NextResponse.json({ ok: false, error: "Could not reverse geocode location" }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      address: data.results[0].formatted_address,
      lat,
      lng,
    });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
