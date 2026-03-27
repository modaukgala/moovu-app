import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tripId = String(url.searchParams.get("tripId") ?? "").trim();

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Missing tripId" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: trip, error: tripErr } = await supabase
      .from("trips")
      .select(`
        id,
        rider_name,
        rider_phone,
        pickup_address,
        dropoff_address,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        payment_method,
        fare_amount,
        status,
        driver_id,
        offer_status,
        offer_expires_at,
        start_otp,
        end_otp,
        start_otp_verified,
        end_otp_verified,
        created_at
      `)
      .eq("id", tripId)
      .maybeSingle();

    if (tripErr) {
      return NextResponse.json({ ok: false, error: tripErr.message }, { status: 500 });
    }

    if (!trip) {
      return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    }

    let driver: any = null;
    if (trip.driver_id) {
      const { data: driverRow } = await supabase
        .from("drivers")
        .select(`
          id,
          first_name,
          last_name,
          phone,
          lat,
          lng,
          last_seen,
          vehicle_make,
          vehicle_model,
          vehicle_year,
          vehicle_color,
          vehicle_registration
        `)
        .eq("id", trip.driver_id)
        .maybeSingle();

      driver = driverRow ?? null;
    }

    const { data: events } = await supabase
      .from("trip_events")
      .select("id,event_type,message,old_status,new_status,created_at")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      ok: true,
      trip,
      driver,
      events: events ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}