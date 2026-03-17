import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type BookTripBody = {
  riderName?: string | null;
  rider_name?: string | null;
  riderPhone?: string | null;
  rider_phone?: string | null;

  pickupAddress?: string | null;
  pickup_address?: string | null;
  pickup?: string | null;

  dropoffAddress?: string | null;
  dropoff_address?: string | null;
  dropoff?: string | null;

  pickupLat?: number | null;
  pickup_lat?: number | null;
  pickupLng?: number | null;
  pickup_lng?: number | null;

  dropoffLat?: number | null;
  dropoff_lat?: number | null;
  dropoffLng?: number | null;
  dropoff_lng?: number | null;

  paymentMethod?: string | null;
  payment_method?: string | null;

  fareAmount?: number | null;
  fare_amount?: number | null;
};

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickFirstString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as BookTripBody;

    const riderName = pickFirstString(body.riderName, body.rider_name) || null;
    const riderPhone = pickFirstString(body.riderPhone, body.rider_phone) || null;

    const pickupAddress = pickFirstString(
      body.pickupAddress,
      body.pickup_address,
      body.pickup
    );

    const dropoffAddress = pickFirstString(
      body.dropoffAddress,
      body.dropoff_address,
      body.dropoff
    );

    const pickupLat = asNumber(body.pickupLat ?? body.pickup_lat);
    const pickupLng = asNumber(body.pickupLng ?? body.pickup_lng);
    const dropoffLat = asNumber(body.dropoffLat ?? body.dropoff_lat);
    const dropoffLng = asNumber(body.dropoffLng ?? body.dropoff_lng);

    const paymentMethod =
      pickFirstString(body.paymentMethod, body.payment_method).toLowerCase() || "cash";

    const fareAmount = asNumber(body.fareAmount ?? body.fare_amount);

    if (!pickupAddress || !dropoffAddress) {
      return NextResponse.json(
        {
          ok: false,
          error: "Pickup and dropoff addresses are required.",
          debug: {
            receivedPickup: body.pickupAddress ?? body.pickup_address ?? body.pickup ?? null,
            receivedDropoff: body.dropoffAddress ?? body.dropoff_address ?? body.dropoff ?? null,
          },
        },
        { status: 400 }
      );
    }

    if (pickupLat == null || pickupLng == null) {
      return NextResponse.json(
        { ok: false, error: "Pickup coordinates are required." },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const insertPayload = {
      rider_name: riderName,
      rider_phone: riderPhone,
      pickup_address: pickupAddress,
      dropoff_address: dropoffAddress,
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      dropoff_lat: dropoffLat,
      dropoff_lng: dropoffLng,
      payment_method: paymentMethod,
      fare_amount: fareAmount,
      status: "requested",
      offer_status: null,
      driver_id: null,
    };

    const { data: trip, error: tripErr } = await supabase
      .from("trips")
      .insert(insertPayload)
      .select("*")
      .single();

    if (tripErr || !trip) {
      return NextResponse.json(
        { ok: false, error: tripErr?.message || "Failed to create trip." },
        { status: 500 }
      );
    }

    await supabase.from("trip_events").insert({
      trip_id: trip.id,
      event_type: "trip_created",
      message: "Trip requested by customer",
      old_status: null,
      new_status: "requested",
    });

    await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/push/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: "admin",
        title: "New trip request",
        body: `A new trip was requested from ${pickupAddress} to ${dropoffAddress}.`,
        url: "/admin/trips",
      }),
    }).catch(() => null);

    return NextResponse.json({
      ok: true,
      tripId: trip.id,
      trip,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}