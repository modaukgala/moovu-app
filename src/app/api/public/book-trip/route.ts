import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const rider_name = String(body.rider_name ?? "").trim();
    const rider_phone = String(body.rider_phone ?? "").trim();

    const pickup_address = String(body.pickup_address ?? "").trim();
    const dropoff_address = String(body.dropoff_address ?? "").trim();

    const pickup_lat = body.pickup_lat;
    const pickup_lng = body.pickup_lng;

    const dropoff_lat = body.dropoff_lat;
    const dropoff_lng = body.dropoff_lng;

    const fare_amount = body.fare_amount ?? null;
    const payment_method = body.payment_method ?? "cash";

    if (!rider_name) {
      return NextResponse.json(
        { ok: false, error: "Missing rider name" },
        { status: 400 }
      );
    }

    if (!rider_phone) {
      return NextResponse.json(
        { ok: false, error: "Missing rider phone" },
        { status: 400 }
      );
    }

    if (!pickup_address || !dropoff_address) {
      return NextResponse.json(
        { ok: false, error: "Pickup and destination required" },
        { status: 400 }
      );
    }

    const { data: trip, error } = await supabaseAdmin
      .from("trips")
      .insert({
        rider_name,
        rider_phone,
        pickup_address,
        dropoff_address,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        fare_amount,
        payment_method,
        status: "requested",
        offer_status: null,
        driver_id: null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    await supabaseAdmin.from("trip_events").insert({
      trip_id: trip.id,
      event_type: "booking_created",
      message: "Trip created from rider booking page",
      old_status: null,
      new_status: "requested",
    });

    return NextResponse.json({
      ok: true,
      tripId: trip.id,
      status: trip.status,
      fare_amount: trip.fare_amount,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}