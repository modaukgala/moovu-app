import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tripId = searchParams.get("tripId");

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID is required." },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select(`
        id,
        status,
        pickup_address,
        dropoff_address,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        fare_amount,
        payment_method,
        driver_id,
        created_at,
        cancel_reason
      `)
      .eq("id", tripId)
      .maybeSingle();

    if (tripError) {
      return NextResponse.json(
        { ok: false, error: tripError.message },
        { status: 500 }
      );
    }

    if (!trip) {
      return NextResponse.json({ ok: true, trip: null });
    }

    let driver_name: string | null = null;
    let driver_phone: string | null = null;
    let driver_lat: number | null = null;
    let driver_lng: number | null = null;
    let vehicle_make: string | null = null;
    let vehicle_model: string | null = null;
    let vehicle_color: string | null = null;
    let vehicle_registration: string | null = null;

    if (trip.driver_id) {
      const { data: driverData } = await supabase
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

      if (driverData) {
        driver_name =
          `${driverData.first_name ?? ""} ${driverData.last_name ?? ""}`.trim() || null;
        driver_phone = driverData.phone ?? null;
        driver_lat = toNumber(driverData.lat);
        driver_lng = toNumber(driverData.lng);
        vehicle_make = driverData.vehicle_make ?? null;
        vehicle_model = driverData.vehicle_model ?? null;
        vehicle_color = driverData.vehicle_color ?? null;
        vehicle_registration = driverData.vehicle_registration ?? null;
      }
    }

    return NextResponse.json({
      ok: true,
      trip: {
        id: trip.id,
        status: trip.status,
        pickup_address: trip.pickup_address ?? null,
        dropoff_address: trip.dropoff_address ?? null,
        pickup_lat: toNumber(trip.pickup_lat),
        pickup_lng: toNumber(trip.pickup_lng),
        dropoff_lat: toNumber(trip.dropoff_lat),
        dropoff_lng: toNumber(trip.dropoff_lng),
        fare_amount: toNumber(trip.fare_amount),
        payment_method: trip.payment_method ?? null,
        driver_id: trip.driver_id ?? null,
        created_at: trip.created_at ?? null,
        cancel_reason: trip.cancel_reason ?? null,

        driver_name,
        driver_phone,
        driver_lat,
        driver_lng,
        vehicle_make,
        vehicle_model,
        vehicle_color,
        vehicle_registration,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}