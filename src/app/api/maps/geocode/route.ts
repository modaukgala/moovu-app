import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { place } = await req.json();

    if (!place) {
      return NextResponse.json(
        { ok: false, error: "Missing place name" },
        { status: 400 }
      );
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
      "https://maps.googleapis.com/maps/api/geocode/json" +
      `?address=${encodeURIComponent(`${place}, South Africa`)}` +
      `&key=${encodeURIComponent(key)}`;

    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    if (data.status !== "OK" || !data.results?.length) {
      return NextResponse.json(
        { ok: false, error: "Location not found" },
        { status: 404 }
      );
    }

    const result = data.results[0];

    return NextResponse.json({
      ok: true,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      address: result.formatted_address,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}