import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { origin_place_id, destination_place_id } = await req.json();

    if (!origin_place_id || !destination_place_id) {
      return NextResponse.json({ ok: false, error: "Missing origin/destination place_id" }, { status: 400 });
    }

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      return NextResponse.json({ ok: false, error: "Missing GOOGLE_MAPS_API_KEY" }, { status: 500 });
    }

    const origins = `place_id:${origin_place_id}`;
    const destinations = `place_id:${destination_place_id}`;

    const dmUrl =
      "https://maps.googleapis.com/maps/api/distancematrix/json" +
      `?origins=${encodeURIComponent(origins)}` +
      `&destinations=${encodeURIComponent(destinations)}` +
      `&mode=driving` +
      `&units=metric` +
      `&region=za` +
      `&key=${encodeURIComponent(key)}`;

    const dmResp = await fetch(dmUrl);
    const dm = await dmResp.json();

    if (dm.status !== "OK") {
      return NextResponse.json(
        { ok: false, error: "Distance Matrix request failed", dm_status: dm.status, dm_error_message: dm.error_message },
        { status: 400 }
      );
    }

    const element = dm?.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK") {
      return NextResponse.json(
        { ok: false, error: "No route found", element_status: element?.status ?? null },
        { status: 400 }
      );
    }

    const distanceMeters = element.distance.value as number;
    const durationSeconds = element.duration.value as number;

    const distanceKm = Math.round((distanceMeters / 1000) * 100) / 100;
    const durationMin = Math.round((durationSeconds / 60) * 10) / 10;

    return NextResponse.json({
      ok: true,
      distanceKm,
      durationMin,
      distanceText: element.distance.text,
      durationText: element.duration.text,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}