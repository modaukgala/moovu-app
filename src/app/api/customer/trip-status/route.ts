import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { releaseDueScheduledTrips } from "@/lib/operations/releaseDueScheduledTrips";

type CustomerTripStatusRow = {
  id: string;
  customer_id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  payment_method: string | null;
  distance_km: number | null;
  duration_min: number | null;
  fare_amount: number | null;
  status: string;
  driver_id: string | null;
  offer_status: string | null;
  offer_expires_at: string | null;
  start_otp: string | null;
  end_otp: string | null;
  start_otp_verified: boolean | null;
  end_otp_verified: boolean | null;
  created_at: string | null;
  cancel_reason: string | null;
  scheduled_for: string | null;
  scheduled_release_at: string | null;
  ride_type: string | null;
  schedule_status: string | null;
  cancellation_fee_amount: number | null;
};

type CustomerTripDriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  last_seen: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: string | null;
  vehicle_color: string | null;
  vehicle_registration: string | null;
};

type TripEventRow = {
  id: string;
  event_type: string;
  message: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
};

const DRIVER_VISIBLE_STATUSES = new Set([
  "assigned",
  "arrived",
  "ongoing",
  "completed",
  "cancelled",
]);

function buildTrackingState(params: {
  trip: CustomerTripStatusRow;
  driver: CustomerTripDriverRow | null;
}) {
  const { trip, driver } = params;

  const lastSeen = driver?.last_seen ? new Date(driver.last_seen).getTime() : null;
  const freshnessSeconds =
    lastSeen != null ? Math.max(0, Math.floor((Date.now() - lastSeen) / 1000)) : null;

  let liveState = "waiting";
  if (trip.status === "offered" || trip.status === "assigned") liveState = "driver_on_the_way";
  if (trip.status === "arrived") liveState = "driver_arrived";
  if (trip.status === "ongoing") liveState = "trip_in_progress";
  if (trip.status === "completed") liveState = "trip_completed";
  if (trip.status === "cancelled") liveState = "trip_cancelled";
  if (trip.status === "scheduled") liveState = "scheduled";

  const driverFresh = freshnessSeconds == null ? false : freshnessSeconds <= 90;

  return {
    liveState,
    driverFresh,
    freshnessSeconds,
    driverLastSeen: driver?.last_seen ?? null,
    startOtpVerified: !!trip.start_otp_verified,
    endOtpVerified: !!trip.end_otp_verified,
    scheduledFor: trip.scheduled_for ?? null,
    scheduledReleaseAt: trip.scheduled_release_at ?? null,
  };
}

export async function GET(req: Request) {
  try {
    await releaseDueScheduledTrips().catch(() => {});

    const auth = await getAuthenticatedCustomer(req);

    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const url = new URL(req.url);
    const tripId = String(url.searchParams.get("tripId") ?? "").trim();

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Missing tripId" }, { status: 400 });
    }

    const { data: trip, error: tripErr } = await auth.supabaseAdmin
      .from("trips")
      .select(`
        id,
        customer_id,
        rider_name,
        rider_phone,
        pickup_address,
        dropoff_address,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        payment_method,
        distance_km,
        duration_min,
        fare_amount,
        status,
        driver_id,
        offer_status,
        offer_expires_at,
        start_otp,
        end_otp,
        start_otp_verified,
        end_otp_verified,
        created_at,
        cancel_reason,
        scheduled_for,
        scheduled_release_at,
        ride_type,
        schedule_status,
        cancellation_fee_amount
      `)
      .eq("id", tripId)
      .eq("customer_id", auth.customer.id)
      .maybeSingle();

    if (tripErr) {
      return NextResponse.json({ ok: false, error: tripErr.message }, { status: 500 });
    }

    if (!trip) {
      return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    }

    const typedTrip = trip as CustomerTripStatusRow;
    let driver: CustomerTripDriverRow | null = null;
    if (trip.driver_id && DRIVER_VISIBLE_STATUSES.has(trip.status)) {
      const { data: driverRow } = await auth.supabaseAdmin
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

      driver = (driverRow as CustomerTripDriverRow | null) ?? null;
    }

    const { data: events } = await auth.supabaseAdmin
      .from("trip_events")
      .select("id,event_type,message,old_status,new_status,created_at")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });

    const { data: rating } = await auth.supabaseAdmin
      .from("trip_ratings")
      .select("id,rating,comment")
      .eq("trip_id", tripId)
      .maybeSingle();

    const typedEvents = ((events ?? []) as TripEventRow[]);
    const completedEvent = typedEvents.find((event) => event.event_type === "trip_completed");

    return NextResponse.json({
      ok: true,
      trip: {
        ...trip,
        completed_at: completedEvent?.created_at ?? null,
      },
      driver,
      events: typedEvents,
      rating: rating ?? null,
      tracking: buildTrackingState({ trip: typedTrip, driver }),
      customer: {
        id: auth.customer.id,
        first_name: auth.customer.first_name,
        last_name: auth.customer.last_name,
        phone: auth.customer.phone,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error." },
      { status: 500 }
    );
  }
}
