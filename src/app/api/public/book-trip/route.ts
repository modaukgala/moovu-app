import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateFare } from "@/lib/fare/calculateFare";
import { offerNextEligibleDriver } from "@/lib/trip-offers";

function generateOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

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
  distanceKm?: number | null;
  distance_km?: number | null;
  durationMin?: number | null;
  duration_min?: number | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as BookTripBody;

    const riderName = pickFirstString(body.riderName, body.rider_name) || null;
    const riderPhone = pickFirstString(body.riderPhone, body.rider_phone) || null;

    const pickupAddress = pickFirstString(body.pickupAddress, body.pickup_address, body.pickup);
    const dropoffAddress = pickFirstString(body.dropoffAddress, body.dropoff_address, body.dropoff);

    const pickupLat = asNumber(body.pickupLat ?? body.pickup_lat);
    const pickupLng = asNumber(body.pickupLng ?? body.pickup_lng);
    const dropoffLat = asNumber(body.dropoffLat ?? body.dropoff_lat);
    const dropoffLng = asNumber(body.dropoffLng ?? body.dropoff_lng);

    const distanceKm = asNumber(body.distanceKm ?? body.distance_km) ?? 0;
    const durationMin = asNumber(body.durationMin ?? body.duration_min) ?? 0;
    const paymentMethod =
      pickFirstString(body.paymentMethod, body.payment_method).toLowerCase() || "cash";

    if (!pickupAddress || !dropoffAddress) {
      return NextResponse.json(
        { ok: false, error: "Pickup and dropoff addresses are required." },
        { status: 400 }
      );
    }

    if (pickupLat == null || pickupLng == null || dropoffLat == null || dropoffLng == null) {
      return NextResponse.json(
        { ok: false, error: "Pickup and dropoff coordinates are required." },
        { status: 400 }
      );
    }

    const fare = calculateFare({ distanceKm, durationMin });
    const startOtp = generateOtp();
    const endOtp = generateOtp();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: trip, error: tripErr } = await supabase
      .from("trips")
      .insert({
        rider_name: riderName,
        rider_phone: riderPhone,
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        dropoff_lat: dropoffLat,
        dropoff_lng: dropoffLng,
        payment_method: paymentMethod,
        distance_km: distanceKm,
        duration_min: durationMin,
        fare_amount: fare.totalFare,
        status: "requested",
        offer_status: null,
        driver_id: null,
        start_otp: startOtp,
        end_otp: endOtp,
        start_otp_verified: false,
        end_otp_verified: false,
        otp_verified: false,
      })
      .select("*")
      .single();

    if (tripErr || !trip) {
      return NextResponse.json(
        { ok: false, error: tripErr?.message || "Failed to create trip." },
        { status: 500 }
      );
    }

    try {
      await supabase.from("trip_events").insert({
        trip_id: trip.id,
        event_type: "trip_created",
        message: "Trip requested by customer",
        old_status: null,
        new_status: "requested",
      });
    } catch {}

    try {
      if (process.env.NEXT_PUBLIC_SITE_URL) {
        await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/push/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "admin",
            title: "New trip request",
            body: `A new trip was requested from ${pickupAddress} to ${dropoffAddress}.`,
            url: "/admin/trips",
          }),
        });
      }
    } catch {}

    let autoOfferResult: any = null;
    try {
      autoOfferResult = await offerNextEligibleDriver(trip.id, []);
    } catch {
      autoOfferResult = null;
    }

    return NextResponse.json({
      ok: true,
      tripId: trip.id,
      trip,
      fareBreakdown: fare,
      otp: { startOtp, endOtp },
      autoOfferStarted: !!autoOfferResult?.ok,
      autoOfferResult,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}