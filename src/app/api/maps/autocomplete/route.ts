import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { input } = await req.json();

    if (!input || String(input).trim().length < 3) {
      return NextResponse.json({ ok: true, predictions: [] });
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
      "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
      `?input=${encodeURIComponent(input)}` +
      `&components=country:za` +
      `&language=en` +
      `&key=${encodeURIComponent(key)}`;

    const resp = await fetch(url, { cache: "no-store" });
    const data = await resp.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return NextResponse.json(
        {
          ok: false,
          error: "Places autocomplete failed",
          status: data.status,
          message: data.error_message,
        },
        { status: 400 }
      );
    }

    const predictions =
      (data.predictions ?? []).map((p: any) => ({
        description: p.description,
        place_id: p.place_id,
      })) ?? [];

    return NextResponse.json({ ok: true, predictions });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}