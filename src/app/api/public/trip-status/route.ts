import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  try {
    const tripId = req.nextUrl.searchParams.get("tripId");

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Missing tripId" },
        { status: 400 }
      );
    }

    const { data: trip, error: tripErr } = await supabaseAdmin
      .from("trips")
      .select(
        "id,status,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,fare_amount,payment_method,driver_id"
      )
      .eq("id", tripId)
      .maybeSingle();

    if (tripErr) {
      return NextResponse.json(
        { ok: false, error: tripErr.message },
        { status: 500 }
      );
    }

    if (!trip) {
      return NextResponse.json(
        { ok: false, error: "Trip not found" },
        { status: 404 }
      );
    }

    let driver: any = null;

    if (trip.driver_id) {
      const { data: d, error: driverErr } = await supabaseAdmin
        .from("drivers")
        .select(
          "id,first_name,last_name,phone,lat,lng,vehicle_make,vehicle_model,vehicle_color,vehicle_registration"
        )
        .eq("id", trip.driver_id)
        .maybeSingle();

      if (!driverErr && d) {
        driver = d;
      }
    }

    return NextResponse.json({
      ok: true,
      trip: {
        id: trip.id,
        status: trip.status,
        pickup_address: trip.pickup_address,
        dropoff_address: trip.dropoff_address,
        pickup_lat: trip.pickup_lat,
        pickup_lng: trip.pickup_lng,
        dropoff_lat: trip.dropoff_lat,
        dropoff_lng: trip.dropoff_lng,
        fare_amount: trip.fare_amount,
        payment_method: trip.payment_method,
        driver_id: trip.driver_id,

        driver_name: driver
          ? `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || "Driver"
          : null,
        driver_phone: driver?.phone ?? null,
        driver_vehicle_make: driver?.vehicle_make ?? null,
        driver_vehicle_model: driver?.vehicle_model ?? null,
        driver_vehicle_color: driver?.vehicle_color ?? null,
        driver_vehicle_registration: driver?.vehicle_registration ?? null,
        driver_lat: driver?.lat ?? null,
        driver_lng: driver?.lng ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}