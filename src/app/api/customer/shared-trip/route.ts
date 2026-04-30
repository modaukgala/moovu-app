import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/customer/server";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = String(url.searchParams.get("token") ?? "").trim();

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing share token." }, { status: 400 });
    }

    const supabase = createServiceSupabase();

    const { data: share, error: shareError } = await supabase
      .from("trip_shares")
      .select("id,trip_id,is_active,created_at")
      .eq("share_token", token)
      .maybeSingle();

    if (shareError) {
      return NextResponse.json({ ok: false, error: shareError.message }, { status: 500 });
    }

    if (!share || !share.is_active) {
      return NextResponse.json({ ok: false, error: "Shared trip link is not active." }, { status: 404 });
    }

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select(`
        id,
        pickup_address,
        dropoff_address,
        status,
        fare_amount,
        start_otp_verified,
        driver_id,
        created_at
      `)
      .eq("id", share.trip_id)
      .maybeSingle();

    if (tripError) {
      return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
    }

    if (!trip) {
      return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    }

    if (!trip.start_otp_verified) {
      return NextResponse.json(
        { ok: false, error: "Trip has not started yet." },
        { status: 400 }
      );
    }

    let driver: unknown = null;
    if (trip.driver_id) {
      const { data: driverRow } = await supabase
        .from("drivers")
        .select(`
          first_name,
          last_name,
          phone,
          lat,
          lng,
          vehicle_make,
          vehicle_model,
          vehicle_color,
          vehicle_registration
        `)
        .eq("id", trip.driver_id)
        .maybeSingle();

      driver = driverRow ?? null;
    }

    return NextResponse.json({
      ok: true,
      trip,
      driver,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error.") },
      { status: 500 }
    );
  }
}
