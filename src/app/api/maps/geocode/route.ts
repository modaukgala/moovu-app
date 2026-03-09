import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { place } = await req.json();

    if (!place) {
      return NextResponse.json({ ok: false, error: "Missing place name" });
    }

    const key = process.env.GOOGLE_MAPS_API_KEY;

    const url =
      "https://maps.googleapis.com/maps/api/geocode/json" +
      `?address=${encodeURIComponent(place + ", Mpumalanga, South Africa")}` +
      `&key=${key}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "OK") {
      return NextResponse.json({ ok: false, error: "Location not found" });
    }

    const result = data.results[0];

    return NextResponse.json({
      ok: true,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      address: result.formatted_address
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}