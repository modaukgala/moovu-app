import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { place_id } = await req.json();

    if (!place_id) {
      return NextResponse.json({ ok: false, error: "Missing place_id" }, { status: 400 });
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
      "https://maps.googleapis.com/maps/api/place/details/json" +
      `?place_id=${encodeURIComponent(place_id)}` +
      `&fields=formatted_address,name,place_id,geometry/location` +
      `&language=en` +
      `&key=${encodeURIComponent(key)}`;

    const resp = await fetch(url, { cache: "no-store" });
    const data = await resp.json();

    if (data.status !== "OK") {
      return NextResponse.json(
        {
          ok: false,
          error: "Place details failed",
          status: data.status,
          message: data.error_message,
        },
        { status: 400 }
      );
    }

    const result = data.result;

    return NextResponse.json({
      ok: true,
      place_id: result.place_id,
      formatted_address: result.formatted_address ?? result.name,
      name: result.name,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}