import { NextResponse } from "next/server";
import { calculateFare } from "@/lib/fare/calculateFare";
import { offerNextEligibleDriver } from "@/lib/trip-offers";
import { fullCustomerName } from "@/lib/customer/auth";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { releaseDueScheduledTrips } from "@/lib/operations/releaseDueScheduledTrips";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";

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

function parseScheduledDate(value: string | null) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

type BookTripBody = {
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
  rideType?: string | null;
  ride_type?: string | null;
  scheduledFor?: string | null;
  scheduled_for?: string | null;
};

export async function POST(req: Request) {
  try {
    await releaseDueScheduledTrips().catch(() => {});

    const auth = await getAuthenticatedCustomer(req);

    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    if (auth.customer.status !== "active") {
      return NextResponse.json(
        { ok: false, error: "Your customer account is not active." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as BookTripBody;

    const pickupAddress = pickFirstString(body.pickupAddress, body.pickup_address, body.pickup);
    const dropoffAddress = pickFirstString(body.dropoffAddress, body.dropoff_address, body.dropoff);

    const pickupLat = asNumber(body.pickupLat ?? body.pickup_lat);
    const pickupLng = asNumber(body.pickupLng ?? body.pickup_lng);
    const dropoffLat = asNumber(body.dropoffLat ?? body.dropoff_lat);
    const dropoffLng = asNumber(body.dropoffLng ?? body.dropoff_lng);

    const paymentMethod = pickFirstString(body.paymentMethod, body.payment_method) || "cash";
    const distanceKm = asNumber(body.distanceKm ?? body.distance_km);
    const durationMin = asNumber(body.durationMin ?? body.duration_min);

    const rideTypeRaw = pickFirstString(body.rideType, body.ride_type) || "now";
    const rideType = rideTypeRaw === "scheduled" ? "scheduled" : "now";

    const scheduledForRaw = pickFirstString(body.scheduledFor, body.scheduled_for);
    const scheduledDate = rideType === "scheduled" ? parseScheduledDate(scheduledForRaw) : null;
    const scheduledFor = scheduledDate ? scheduledDate.toISOString() : null;

    if (!pickupAddress || !dropoffAddress) {
      return NextResponse.json(
        { ok: false, error: "Pickup and destination are required." },
        { status: 400 }
      );
    }

    if (pickupLat == null || pickupLng == null || dropoffLat == null || dropoffLng == null) {
      return NextResponse.json(
        { ok: false, error: "Pickup and destination coordinates are required." },
        { status: 400 }
      );
    }

    if (distanceKm == null || durationMin == null) {
      return NextResponse.json(
        { ok: false, error: "Distance and duration are required." },
        { status: 400 }
      );
    }

    if (rideType === "scheduled") {
      if (!scheduledDate || !scheduledFor) {
        return NextResponse.json(
          { ok: false, error: "Please choose a valid scheduled date and time." },
          { status: 400 }
        );
      }

      const now = Date.now();
      const scheduledMs = scheduledDate.getTime();
      const minimumLeadMs = 15 * 60 * 1000;

      if (scheduledMs <= now) {
        return NextResponse.json(
          { ok: false, error: "Scheduled trip time must be in the future." },
          { status: 400 }
        );
      }

      if (scheduledMs - now < minimumLeadMs) {
        return NextResponse.json(
          { ok: false, error: "Scheduled trips must be at least 15 minutes ahead." },
          { status: 400 }
        );
      }
    }

    const fare = calculateFare({
      distanceKm,
      durationMin,
    });

    const startOtp = generateOtp();
    const endOtp = generateOtp();
    const riderName = fullCustomerName(auth.customer.first_name, auth.customer.last_name);

    const initialStatus = rideType === "scheduled" ? "scheduled" : "requested";
    const scheduleStatus = rideType === "scheduled" ? "scheduled" : "none";
    const scheduledReleaseAt =
      rideType === "scheduled" && scheduledFor
        ? new Date(new Date(scheduledFor).getTime() - 15 * 60 * 1000).toISOString()
        : null;

    const { data: trip, error: tripErr } = await auth.supabaseAdmin
      .from("trips")
      .insert({
        customer_id: auth.customer.id,
        customer_auth_user_id: auth.user.id,
        rider_name: riderName,
        rider_phone: auth.customer.phone,
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
        status: initialStatus,
        ride_type: rideType,
        scheduled_for: scheduledFor,
        scheduled_release_at: scheduledReleaseAt,
        schedule_status: scheduleStatus,
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
      await auth.supabaseAdmin.from("trip_events").insert({
        trip_id: trip.id,
        event_type: rideType === "scheduled" ? "scheduled_trip_created" : "trip_created",
        message:
          rideType === "scheduled"
            ? `Scheduled trip created for ${scheduledFor}. Auto release planned for ${scheduledReleaseAt}.`
            : "Trip requested by authenticated customer",
        old_status: null,
        new_status: initialStatus,
      });
    } catch {}

    await notifyCustomerForTrip(
      trip.id,
      rideType === "scheduled" ? "Scheduled ride created" : "Ride request received",
      rideType === "scheduled"
        ? `Your ride has been scheduled from ${pickupAddress} to ${dropoffAddress}.`
        : `We received your ride request from ${pickupAddress} to ${dropoffAddress}.`,
      "/book"
    );

    await notifyAdmins(
      rideType === "scheduled" ? "New scheduled ride" : "New ride request",
      `${riderName} requested a ride from ${pickupAddress} to ${dropoffAddress}.`,
      "/admin/trips"
    );

    let autoOfferResult: any = null;

    if (rideType === "now") {
      try {
        autoOfferResult = await offerNextEligibleDriver(trip.id, []);
      } catch {
        autoOfferResult = null;
      }
    }

    return NextResponse.json({
      ok: true,
      tripId: trip.id,
      trip,
      fareBreakdown: fare,
      otp: { startOtp, endOtp },
      autoOfferStarted: rideType === "now" ? !!autoOfferResult?.ok : false,
      autoOfferResult,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}