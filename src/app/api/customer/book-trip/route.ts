import { NextResponse } from "next/server";
import { calculateFare } from "@/lib/fare/calculateFare";
import {
  MAX_TRIP_STOPS,
  calculateAddStopIncrease,
  calculateStopWaitingFee,
  getRideOption,
  normalizeRideOptionId,
} from "@/lib/domain/fare";
import { getActiveManualSurge } from "@/lib/pricing/manualSurgeServer";
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

function hasOkFlag(value: unknown): value is { ok?: boolean } {
  return typeof value === "object" && value !== null && "ok" in value;
}

function isMissingOptionalPricingColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42703" && (
    message.includes("surge_label") ||
    message.includes("surge_multiplier") ||
    message.includes("fare_breakdown") ||
    message.includes("stops") ||
    message.includes("original_distance_km") ||
    message.includes("original_duration_min") ||
    message.includes("original_fare") ||
    message.includes("route_distance_km") ||
    message.includes("route_duration_min") ||
    message.includes("extra_stop_distance_km") ||
    message.includes("extra_stop_duration_min") ||
    message.includes("raw_add_stop_increase") ||
    message.includes("add_stop_discount_percent") ||
    message.includes("final_add_stop_increase") ||
    message.includes("stop_waiting_fee") ||
    message.includes("final_fare")
  );
}

type StopPayload = {
  address?: string | null;
  placeId?: string | null;
  place_id?: string | null;
  lat?: number | null;
  lng?: number | null;
};

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
  originalDistanceKm?: number | null;
  original_distance_km?: number | null;
  originalDurationMin?: number | null;
  original_duration_min?: number | null;
  stops?: StopPayload[] | null;
  rideType?: string | null;
  ride_type?: string | null;
  rideOption?: string | null;
  ride_option?: string | null;
  scheduledFor?: string | null;
  scheduled_for?: string | null;
  notes?: string | null;
};

function normalizeStops(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TRIP_STOPS).map((stop) => {
    const item = (stop ?? {}) as StopPayload;
    return {
      address: pickFirstString(item.address),
      placeId: pickFirstString(item.placeId, item.place_id),
      lat: asNumber(item.lat),
      lng: asNumber(item.lng),
    };
  }).filter((stop) => stop.address && stop.lat != null && stop.lng != null);
}

function samePoint(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return Math.abs(a.lat - b.lat) < 0.00008 && Math.abs(a.lng - b.lng) < 0.00008;
}

async function fetchDistanceLeg(params: {
  apiKey: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
}) {
  const origin = `${params.origin.lat},${params.origin.lng}`;
  const destination = `${params.destination.lat},${params.destination.lng}`;
  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json` +
    `?origins=${encodeURIComponent(origin)}` +
    `&destinations=${encodeURIComponent(destination)}` +
    `&mode=driving` +
    `&language=en` +
    `&region=za` +
    `&key=${encodeURIComponent(params.apiKey)}`;

  const response = await fetch(url, { method: "GET", cache: "no-store" });
  const data = await response.json().catch(() => null);
  const element = data?.rows?.[0]?.elements?.[0];

  if (!response.ok || data?.status !== "OK" || !element || element.status !== "OK") {
    throw new Error(
      element?.status === "ZERO_RESULTS"
        ? "No driving route found between the selected locations."
        : data?.error_message || "Could not calculate route."
    );
  }

  return {
    distanceKm: Number(element.distance?.value ?? 0) / 1000,
    durationMin: Number(element.duration?.value ?? 0) / 60,
  };
}

async function calculateServerRoute(params: {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  stops: Array<{ lat: number; lng: number }>;
}) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  if (!apiKey) return null;

  const original = await fetchDistanceLeg({
    apiKey,
    origin: params.pickup,
    destination: params.dropoff,
  });

  const points = [params.pickup, ...params.stops, params.dropoff];
  let routeDistanceKm = 0;
  let routeDurationMin = 0;

  for (let i = 0; i < points.length - 1; i += 1) {
    const leg = await fetchDistanceLeg({
      apiKey,
      origin: points[i],
      destination: points[i + 1],
    });
    routeDistanceKm += leg.distanceKm;
    routeDurationMin += leg.durationMin;
  }

  return {
    originalDistanceKm: Number(original.distanceKm.toFixed(2)),
    originalDurationMin: Math.ceil(original.durationMin),
    distanceKm: Number(routeDistanceKm.toFixed(2)),
    durationMin: Math.ceil(routeDurationMin),
  };
}

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
    let distanceKm = asNumber(body.distanceKm ?? body.distance_km);
    let durationMin = asNumber(body.durationMin ?? body.duration_min);
    let originalDistanceKm = asNumber(body.originalDistanceKm ?? body.original_distance_km) ?? distanceKm;
    let originalDurationMin = asNumber(body.originalDurationMin ?? body.original_duration_min) ?? durationMin;
    const stops = normalizeStops(body.stops);

    const rideTypeRaw = pickFirstString(body.rideType, body.ride_type) || "now";
    const rideType = rideTypeRaw === "scheduled" ? "scheduled" : "now";
    const rideOptionId = normalizeRideOptionId(
      pickFirstString(body.rideOption, body.ride_option)
    );
    const rideOption = getRideOption(rideOptionId);

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

    if (originalDistanceKm == null || originalDurationMin == null) {
      return NextResponse.json(
        { ok: false, error: "Original route distance and duration are required." },
        { status: 400 }
      );
    }

    if (Array.isArray(body.stops) && body.stops.length > MAX_TRIP_STOPS) {
      return NextResponse.json(
        { ok: false, error: "A trip can have a maximum of 2 stops." },
        { status: 400 }
      );
    }

    const pickupPoint = { lat: pickupLat, lng: pickupLng };
    const dropoffPoint = { lat: dropoffLat, lng: dropoffLng };
    for (const [index, stop] of stops.entries()) {
      const point = { lat: stop.lat!, lng: stop.lng! };
      if (samePoint(point, pickupPoint)) {
        return NextResponse.json(
          { ok: false, error: `Stop ${index + 1} cannot be the same as pickup.` },
          { status: 400 }
        );
      }
      if (samePoint(point, dropoffPoint)) {
        return NextResponse.json(
          { ok: false, error: `Stop ${index + 1} cannot be the same as final destination.` },
          { status: 400 }
        );
      }
      const duplicate = stops.some((other, otherIndex) =>
        otherIndex !== index &&
        other.lat != null &&
        other.lng != null &&
        samePoint(point, { lat: other.lat, lng: other.lng })
      );
      if (duplicate) {
        return NextResponse.json(
          { ok: false, error: "Duplicate stops are not allowed." },
          { status: 400 }
        );
      }
    }

    if (distanceKm < originalDistanceKm || durationMin < originalDurationMin) {
      return NextResponse.json(
        { ok: false, error: "Stop route cannot be shorter than the original route." },
        { status: 400 }
      );
    }

    const serverRoute = await calculateServerRoute({
      pickup: pickupPoint,
      dropoff: dropoffPoint,
      stops: stops.map((stop) => ({ lat: stop.lat!, lng: stop.lng! })),
    }).catch((error: unknown) => {
      console.error("[book-trip] server route calculation failed", error instanceof Error ? error.message : error);
      return null;
    });

    if (!serverRoute && stops.length > 0) {
      return NextResponse.json(
        { ok: false, error: "Could not calculate the route through your stops. Please adjust the stops and try again." },
        { status: 400 }
      );
    }

    if (serverRoute) {
      distanceKm = serverRoute.distanceKm;
      durationMin = serverRoute.durationMin;
      originalDistanceKm = serverRoute.originalDistanceKm;
      originalDurationMin = serverRoute.originalDurationMin;
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

    const activeSurge = await getActiveManualSurge();
    const fare = calculateFare({
      distanceKm: originalDistanceKm,
      durationMin: originalDurationMin,
      rideOptionId,
      surgeLabel: activeSurge.mode,
      surgeMultiplier: activeSurge.multiplier,
    });
    const addStop = calculateAddStopIncrease({
      rideOptionId,
      originalDistanceKm,
      originalDurationMin,
      routeDistanceKm: distanceKm,
      routeDurationMin: durationMin,
      stopCount: stops.length,
    });
    const stopWaiting = calculateStopWaitingFee({
      rideOptionId,
      stopWaitingMinutes: [],
    });
    const finalFare = Math.round(fare.totalFare + addStop.finalAddStopIncrease + stopWaiting.stopWaitingFee);

    const startOtp = generateOtp();
    const endOtp = generateOtp();
    const riderName = fullCustomerName(auth.customer.first_name, auth.customer.last_name);

    const initialStatus = rideType === "scheduled" ? "scheduled" : "requested";
    const scheduleStatus = rideType === "scheduled" ? "scheduled" : "none";
    const scheduledReleaseAt =
      rideType === "scheduled" && scheduledFor
        ? new Date(new Date(scheduledFor).getTime() - 15 * 60 * 1000).toISOString()
        : null;

    const tripPayload: Record<string, unknown> = {
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
      fare_amount: finalFare,
      ride_option: rideOptionId,
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
      surge_label: activeSurge.mode,
      surge_multiplier: activeSurge.multiplier,
      fare_breakdown: {
        ...fare,
        routeDistanceKm: distanceKm,
        routeDurationMin: durationMin,
        originalDistanceKm,
        originalDurationMin,
        stops,
        addStop,
        stopWaiting,
        finalFare,
      },
      stops,
      original_distance_km: originalDistanceKm,
      original_duration_min: originalDurationMin,
      original_fare: fare.totalFare,
      route_distance_km: distanceKm,
      route_duration_min: durationMin,
      extra_stop_distance_km: addStop.extraDistanceKm,
      extra_stop_duration_min: addStop.extraDurationMin,
      raw_add_stop_increase: addStop.rawAddStopIncrease,
      add_stop_discount_percent: addStop.addStopDiscountPercent,
      final_add_stop_increase: addStop.finalAddStopIncrease,
      stop_waiting_fee: stopWaiting.stopWaitingFee,
      final_fare: finalFare,
    };

    let insertResult = await auth.supabaseAdmin
      .from("trips")
      .insert(tripPayload)
      .select("*")
      .single();

    if (isMissingOptionalPricingColumn(insertResult.error)) {
      const legacyPayload = { ...tripPayload };
      delete legacyPayload.surge_label;
      delete legacyPayload.surge_multiplier;
      delete legacyPayload.fare_breakdown;
      delete legacyPayload.stops;
      delete legacyPayload.original_distance_km;
      delete legacyPayload.original_duration_min;
      delete legacyPayload.original_fare;
      delete legacyPayload.route_distance_km;
      delete legacyPayload.route_duration_min;
      delete legacyPayload.extra_stop_distance_km;
      delete legacyPayload.extra_stop_duration_min;
      delete legacyPayload.raw_add_stop_increase;
      delete legacyPayload.add_stop_discount_percent;
      delete legacyPayload.final_add_stop_increase;
      delete legacyPayload.stop_waiting_fee;
      delete legacyPayload.final_fare;

      insertResult = await auth.supabaseAdmin
        .from("trips")
        .insert(legacyPayload)
        .select("*")
        .single();
    }

    const { data: trip, error: tripErr } = insertResult;

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
            ? `Scheduled trip created for ${scheduledFor}. Auto release planned for ${scheduledReleaseAt}. Ride option: ${rideOption.name}. Surge: ${activeSurge.label}.`
            : `Trip requested by authenticated customer. Ride option: ${rideOption.name}. Surge: ${activeSurge.label}.`,
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
      `/ride/${trip.id}`
    );

    await notifyAdmins(
      rideType === "scheduled" ? "New scheduled ride" : "New Ride Request",
      `${riderName} requested a ride from ${pickupAddress} to ${dropoffAddress}.`,
      "/admin/trips"
    );

    let autoOfferResult: unknown = null;

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
      fareBreakdown: tripPayload.fare_breakdown ?? fare,
      otp: { startOtp, endOtp },
      autoOfferStarted: rideType === "now" && hasOkFlag(autoOfferResult) ? !!autoOfferResult.ok : false,
      autoOfferResult,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
