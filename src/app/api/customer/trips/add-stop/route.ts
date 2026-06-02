import { NextResponse } from "next/server";
import {
  MAX_TRIP_STOPS,
  calculateAddStopIncrease,
  calculateFinalFare,
  calculateStopWaitingFee,
  normalizeRideOptionId,
} from "@/lib/domain/fare";
import { calculateFare } from "@/lib/fare/calculateFare";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { notifyAdmins, notifyDriverForTrip } from "@/lib/push-notify";

type StopPayload = {
  address?: string | null;
  placeId?: string | null;
  place_id?: string | null;
  lat?: number | null;
  lng?: number | null;
};

type TripRow = {
  id: string;
  customer_id: string;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  distance_km: number | null;
  duration_min: number | null;
  fare_amount: number | null;
  ride_option?: string | null;
  surge_label?: string | null;
  surge_multiplier?: number | null;
  stops?: unknown;
  original_distance_km?: number | null;
  original_duration_min?: number | null;
  original_fare?: number | null;
  route_distance_km?: number | null;
  route_duration_min?: number | null;
  final_add_stop_increase?: number | null;
  stop_waiting_fee?: number | null;
  final_fare?: number | null;
};

type StopRecord = {
  address: string;
  placeId: string;
  lat: number;
  lng: number;
};

const ACTIVE_STOP_STATUSES = new Set(["assigned", "arrived", "ongoing"]);

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

function normalizeExistingStops(value: unknown): StopRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_TRIP_STOPS)
    .map((stop) => {
      const item = (stop ?? {}) as StopPayload;
      return {
        address: pickFirstString(item.address),
        placeId: pickFirstString(item.placeId, item.place_id),
        lat: asNumber(item.lat),
        lng: asNumber(item.lng),
      };
    })
    .filter((stop): stop is StopRecord => !!stop.address && stop.lat != null && stop.lng != null);
}

function normalizeNewStop(value: unknown): StopRecord | null {
  const item = (value ?? {}) as StopPayload;
  const address = pickFirstString(item.address);
  const placeId = pickFirstString(item.placeId, item.place_id);
  const lat = asNumber(item.lat);
  const lng = asNumber(item.lng);

  if (!address || lat == null || lng == null) return null;
  return { address, placeId, lat, lng };
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
    "https://maps.googleapis.com/maps/api/distancematrix/json" +
    `?origins=${encodeURIComponent(origin)}` +
    `&destinations=${encodeURIComponent(destination)}` +
    "&mode=driving" +
    "&language=en" +
    "&region=za" +
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

async function calculateRoute(params: {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  stops: Array<{ lat: number; lng: number }>;
}) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  if (!apiKey) throw new Error("Google Maps API key is missing.");

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
    routeDistanceKm: Number(routeDistanceKm.toFixed(2)),
    routeDurationMin: Math.ceil(routeDurationMin),
  };
}

function isMissingAddStopColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42703" && (
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
    message.includes("final_fare") ||
    message.includes("estimated_fare") ||
    message.includes("fare_adjustment_amount") ||
    message.includes("fare_adjustment_reason") ||
    message.includes("active_stop_added_at") ||
    message.includes("active_stop_added_by") ||
    message.includes("active_stop_note")
  );
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthenticatedCustomer(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => null);
    const tripId = String(body?.tripId ?? "").trim();
    const newStop = normalizeNewStop(body?.stop);
    const note = pickFirstString(body?.note).slice(0, 240);

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    }

    if (!newStop) {
      return NextResponse.json(
        { ok: false, error: "Choose a valid stop from the place list before adding it." },
        { status: 400 }
      );
    }

    const { data: trip, error: tripError } = await auth.supabaseAdmin
      .from("trips")
      .select("*")
      .eq("id", tripId)
      .eq("customer_id", auth.customer.id)
      .maybeSingle();

    if (tripError) {
      return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
    }

    if (!trip) {
      return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    }

    const typedTrip = trip as TripRow;
    if (!ACTIVE_STOP_STATUSES.has(typedTrip.status)) {
      return NextResponse.json(
        { ok: false, error: "Stops can only be added after the driver accepts and before the trip is completed." },
        { status: 400 }
      );
    }

    if (
      typedTrip.pickup_lat == null ||
      typedTrip.pickup_lng == null ||
      typedTrip.dropoff_lat == null ||
      typedTrip.dropoff_lng == null
    ) {
      return NextResponse.json(
        { ok: false, error: "Pickup and destination coordinates are required before adding a stop." },
        { status: 400 }
      );
    }

    const existingStops = normalizeExistingStops(typedTrip.stops);
    if (existingStops.length >= MAX_TRIP_STOPS) {
      return NextResponse.json(
        { ok: false, error: "A trip can have a maximum of 2 stops." },
        { status: 400 }
      );
    }

    const pickupPoint = { lat: Number(typedTrip.pickup_lat), lng: Number(typedTrip.pickup_lng) };
    const dropoffPoint = { lat: Number(typedTrip.dropoff_lat), lng: Number(typedTrip.dropoff_lng) };
    const newPoint = { lat: newStop.lat, lng: newStop.lng };

    if (samePoint(newPoint, pickupPoint)) {
      return NextResponse.json(
        { ok: false, error: "Stop cannot be the same as pickup." },
        { status: 400 }
      );
    }

    if (samePoint(newPoint, dropoffPoint)) {
      return NextResponse.json(
        { ok: false, error: "Stop cannot be the same as final destination." },
        { status: 400 }
      );
    }

    if (existingStops.some((stop) => samePoint(newPoint, { lat: stop.lat, lng: stop.lng }))) {
      return NextResponse.json(
        { ok: false, error: "Duplicate stops are not allowed." },
        { status: 400 }
      );
    }

    const stops = [...existingStops, newStop];
    const route = await calculateRoute({
      pickup: pickupPoint,
      dropoff: dropoffPoint,
      stops: stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    }).catch((error: unknown) => {
      console.error("[customer-add-stop] route calculation failed", error instanceof Error ? error.message : error);
      return null;
    });

    if (!route) {
      return NextResponse.json(
        { ok: false, error: "Could not calculate the route through this stop. Please choose another stop and try again." },
        { status: 400 }
      );
    }

    const rideOptionId = normalizeRideOptionId(typedTrip.ride_option);
    const baseFare = calculateFare({
      distanceKm: route.originalDistanceKm,
      durationMin: route.originalDurationMin,
      rideOptionId,
      surgeLabel: typedTrip.surge_label === "busy" || typedTrip.surge_label === "heavy_demand" || typedTrip.surge_label === "rain_event"
        ? typedTrip.surge_label
        : "normal",
      surgeMultiplier: typedTrip.surge_multiplier,
    });
    const addStop = calculateAddStopIncrease({
      rideOptionId,
      originalDistanceKm: route.originalDistanceKm,
      originalDurationMin: route.originalDurationMin,
      routeDistanceKm: route.routeDistanceKm,
      routeDurationMin: route.routeDurationMin,
      stopCount: stops.length,
    });
    const stopWaiting = calculateStopWaitingFee({
      rideOptionId,
      stopWaitingMinutes: [],
    });
    const finalFare = calculateFinalFare({
      originalFare: baseFare.totalFare,
      addStopIncrease: addStop.finalAddStopIncrease,
      stopWaitingFee: stopWaiting.stopWaitingFee,
      fallbackFare: typedTrip.final_fare ?? typedTrip.fare_amount,
    });

    const updatePayload = {
      stops,
      distance_km: route.routeDistanceKm,
      duration_min: route.routeDurationMin,
      fare_amount: finalFare.finalFare,
      original_distance_km: route.originalDistanceKm,
      original_duration_min: route.originalDurationMin,
      original_fare: baseFare.totalFare,
      route_distance_km: route.routeDistanceKm,
      route_duration_min: route.routeDurationMin,
      extra_stop_distance_km: addStop.extraDistanceKm,
      extra_stop_duration_min: addStop.extraDurationMin,
      raw_add_stop_increase: addStop.rawAddStopIncrease,
      add_stop_discount_percent: addStop.addStopDiscountPercent,
      final_add_stop_increase: addStop.finalAddStopIncrease,
      stop_waiting_fee: stopWaiting.stopWaitingFee,
      final_fare: finalFare.finalFare,
      estimated_fare: finalFare.estimatedFare,
      fare_adjustment_amount: finalFare.adjustmentAmount,
      fare_adjustment_reason: stops.length > 0 ? "active_stop_added" : null,
      active_stop_added_at: new Date().toISOString(),
      active_stop_added_by: auth.user.id,
      active_stop_note: note || null,
    };

    const { data: updatedTrip, error: updateError } = await auth.supabaseAdmin
      .from("trips")
      .update(updatePayload)
      .eq("id", tripId)
      .eq("customer_id", auth.customer.id)
      .in("status", Array.from(ACTIVE_STOP_STATUSES))
      .select("*")
      .maybeSingle();

    if (isMissingAddStopColumn(updateError)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Add-stop database fields are not available yet. Run the reviewed add-stop/final-fare migration first.",
        },
        { status: 409 }
      );
    }

    if (updateError || !updatedTrip) {
      return NextResponse.json(
        { ok: false, error: updateError?.message || "Could not add stop to trip." },
        { status: 500 }
      );
    }

    try {
      const { error: eventError } = await auth.supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "active_stop_added",
        message: `Customer added stop ${stops.length}: ${newStop.address}. Pending total updated to R${finalFare.finalFare}.`,
        old_status: typedTrip.status,
        new_status: typedTrip.status,
      });
      if (eventError) {
        console.error("[customer-add-stop] trip event insert failed", eventError.message);
      }
    } catch (error: unknown) {
      console.error("[customer-add-stop] trip event insert failed", error);
    }

    await Promise.all([
      notifyDriverForTrip(
        tripId,
        "Stop added",
        `Customer added stop ${stops.length}: ${newStop.address}.`,
        "/driver",
        { tripId, type: "active_stop_added", finalFare: finalFare.finalFare }
      ).catch((error: unknown) => console.error("[customer-add-stop] driver notify failed", error)),
      notifyAdmins(
        "Trip stop added",
        `Trip ${tripId} now has ${stops.length} stop(s). Pending total R${finalFare.finalFare}.`,
        `/admin/trips/${tripId}`
      ).catch((error: unknown) => console.error("[customer-add-stop] admin notify failed", error)),
    ]);

    return NextResponse.json({
      ok: true,
      trip: updatedTrip,
      fare: finalFare,
      addStop,
      stopWaiting,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
