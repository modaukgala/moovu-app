import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatReceiptNumber(tripId: string, createdAt?: string | null) {
  const shortTrip = tripId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const date = createdAt ? new Date(createdAt) : new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `MV-${y}${m}${d}-${shortTrip}`;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tripId = String(searchParams.get("tripId") ?? "").trim();

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
        rider_name,
        rider_phone,
        pickup_address,
        dropoff_address,
        fare_amount,
        payment_method,
        status,
        driver_id,
        created_at
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
      return NextResponse.json(
        { ok: false, error: "Trip not found." },
        { status: 404 }
      );
    }

    let driver_name: string | null = null;
    let driver_phone: string | null = null;
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
        vehicle_make = driverData.vehicle_make ?? null;
        vehicle_model = driverData.vehicle_model ?? null;
        vehicle_color = driverData.vehicle_color ?? null;
        vehicle_registration = driverData.vehicle_registration ?? null;
      }
    }

    const total = toNumber(trip.fare_amount);
    const vat = total * 15 / 115;
    const subtotal = total - vat;

    const receipt = {
      receipt_number: formatReceiptNumber(trip.id, trip.created_at),
      trip_id: trip.id,
      issued_at: trip.created_at,
      rider_name: trip.rider_name ?? null,
      rider_phone: trip.rider_phone ?? null,
      pickup_address: trip.pickup_address ?? null,
      dropoff_address: trip.dropoff_address ?? null,
      payment_method: trip.payment_method ?? null,
      status: trip.status ?? null,
      driver_name,
      driver_phone,
      vehicle_make,
      vehicle_model,
      vehicle_color,
      vehicle_registration,
      subtotal,
      vat,
      total,
      vat_rate: 15,
    };

    return NextResponse.json({
      ok: true,
      receipt,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}