import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { calculateFare } from "@/lib/fare/calculateFare";
import { normalizeRideOptionId, resolveAdminTripFare } from "@/lib/domain/fare";
import { getActiveManualSurge } from "@/lib/pricing/manualSurgeServer";
import { calculateDrivingRoute } from "@/lib/maps/routeService";
import { isValidLatitude, isValidLongitude } from "@/lib/maps/mapRequestPolicy";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";
import { isAdminTripPaymentMethod } from "@/lib/trips/adminTripPaymentMethod";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const riderName = cleanText(body?.riderName);
    const riderPhone = cleanText(body?.riderPhone);
    const pickup = cleanText(body?.pickup);
    const dropoff = cleanText(body?.dropoff);
    const paymentMethod = cleanText(body?.paymentMethod) || "cash";
    const driverId = cleanText(body?.driverId);
    const rideOptionId = normalizeRideOptionId(body?.rideOptionId ?? body?.rideOption ?? body?.ride_option);
    const pickupLat = Number(body?.pickupLat);
    const pickupLng = Number(body?.pickupLng);
    const dropoffLat = Number(body?.dropoffLat);
    const dropoffLng = Number(body?.dropoffLng);
    const requestedFare = body?.fare == null || body?.fare === "" ? null : Number(body.fare);
    const fareOverrideRequested = body?.fareOverride === true;
    const fareOverrideReason = cleanText(body?.fareOverrideReason).slice(0, 500);

    if (!pickup || !dropoff) {
      return NextResponse.json({ ok: false, error: "Pickup and dropoff are required." }, { status: 400 });
    }

    if (!isAdminTripPaymentMethod(paymentMethod)) {
      return NextResponse.json({ ok: false, error: "Invalid payment method." }, { status: 400 });
    }

    if ([body?.pickupLat, body?.pickupLng, body?.dropoffLat, body?.dropoffLng]
      .some((value) => value == null || value === "")
      || !isValidLatitude(pickupLat) || !isValidLatitude(dropoffLat)
      || !isValidLongitude(pickupLng) || !isValidLongitude(dropoffLng)) {
      return NextResponse.json(
        { ok: false, error: "Valid pickup and dropoff coordinates are required." },
        { status: 400 }
      );
    }

    // Client distance/time are display hints, never an authoritative fare basis.
    const route = await calculateDrivingRoute({
      origin: { lat: pickupLat, lng: pickupLng },
      destination: { lat: dropoffLat, lng: dropoffLng },
      actorKey: `admin:${auth.user.id}`,
    }).catch(() => null);
    if (!route || !Number.isFinite(route.distanceKm) || route.distanceKm <= 0
      || !Number.isFinite(route.durationMin) || route.durationMin < 0) {
      return NextResponse.json(
        { ok: false, error: "A verified route is unavailable. Please retry before creating this trip." },
        { status: 503 },
      );
    }
    const { distanceKm, durationMin } = route;

    const activeSurge = await getActiveManualSurge();
    const calculatedFare = calculateFare({
      distanceKm,
      durationMin,
      rideOptionId,
      surgeLabel: activeSurge.mode,
      surgeMultiplier: activeSurge.multiplier,
    });

    let fareDecision;
    try {
      fareDecision = resolveAdminTripFare({
        calculatedFare: calculatedFare.totalFare,
        overrideRequested: fareOverrideRequested,
        overrideFare: requestedFare,
        overrideReason: fareOverrideReason,
      });
    } catch (error: unknown) {
      return NextResponse.json(
        { ok: false, error: errorMessage(error, "Invalid fare selection.") },
        { status: 400 },
      );
    }
    const fareAmount = fareDecision.amount;

    const startOtp = generateOtp();
    const endOtp = generateOtp();
    // Trip creation is valid independently; selected-driver assignment is a
    // separate authoritative transaction and cannot bypass eligibility.
    const initialStatus = "requested";
    const { supabaseAdmin, user } = auth;

    if (driverId) {
      const { data: driver, error: driverError } = await supabaseAdmin
        .from("drivers")
        .select("id,status")
        .eq("id", driverId)
        .maybeSingle();

      if (driverError) {
        console.error("[admin-trip-create] failed to validate driver", { driverId, error: driverError });
        return NextResponse.json(
          { ok: false, error: "Could not validate selected driver." },
          { status: 500 }
        );
      }

      if (!driver || !["approved", "active"].includes(String(driver.status ?? ""))) {
        return NextResponse.json({ ok: false, error: "Selected driver is not active." }, { status: 400 });
      }
    }

    const { data: trip, error: insertError } = await supabaseAdmin
      .from("trips")
      .insert({
        created_by: user.id,
        rider_name: riderName || null,
        rider_phone: riderPhone || null,
        pickup_address: pickup,
        dropoff_address: dropoff,
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        dropoff_lat: dropoffLat,
        dropoff_lng: dropoffLng,
        payment_method: paymentMethod,
        fare_amount: fareAmount,
        distance_km: distanceKm,
        duration_min: durationMin != null && Number.isFinite(durationMin) ? durationMin : null,
        ride_option: rideOptionId,
        status: initialStatus,
        driver_id: null,
        start_otp: startOtp,
        end_otp: endOtp,
        start_otp_verified: false,
        end_otp_verified: false,
        otp_verified: false,
        surge_label: activeSurge.mode,
        surge_multiplier: activeSurge.multiplier,
        fare_breakdown: {
          ...calculatedFare,
          serverCalculatedFare: calculatedFare.totalFare,
          finalFare: fareAmount,
          adminOverride: fareOverrideRequested
            ? {
                amount: fareAmount,
                reason: fareDecision.reason,
                adminUserId: user.id,
                overriddenAt: new Date().toISOString(),
              }
            : null,
        },
        estimated_fare: calculatedFare.totalFare,
        final_fare: fareAmount,
        original_fare: calculatedFare.totalFare,
        fare_adjustment_amount: fareOverrideRequested
          ? Math.round((fareAmount - calculatedFare.totalFare) * 100) / 100
          : 0,
        fare_adjustment_reason: fareOverrideRequested ? "admin_fare_override" : "admin_booking_confirmed",
      })
      .select("id,status")
      .single();

    if (insertError || !trip) {
      console.error("[admin-trip-create] failed to create trip", insertError);
      return NextResponse.json(
        { ok: false, error: "Could not create trip. Please check the details and try again." },
        { status: 500 }
      );
    }

    await supabaseAdmin.from("trip_events").insert({
      trip_id: trip.id,
      event_type: "created",
      message: `Trip created with start/end OTPs. Surge: ${activeSurge.label}.`,
      old_status: null,
      new_status: trip.status,
      created_by: user.id,
    });

    if (fareOverrideRequested) {
      await supabaseAdmin.from("trip_events").insert({
        trip_id: trip.id,
        event_type: "fare_override",
        message: `Admin overrode server fare R${calculatedFare.totalFare.toFixed(2)} with R${fareAmount.toFixed(2)}. Reason: ${fareDecision.reason}`,
        old_status: trip.status,
        new_status: trip.status,
        created_by: user.id,
      });
    }

    let assignmentWarning: string | null = null;
    if (driverId) {
      const assignment = await callHardenedRpc<{ trip_id: string; driver_id: string; replayed: boolean }>(
        supabaseAdmin,
        "phase05b_assign_driver",
        { p_trip_id: trip.id, p_driver_id: driverId, p_actor_id: user.id },
      );
      if (!assignment.ok) {
        assignmentWarning = assignment.error;
        console.error("[admin-trip-create] trip created but hardened assignment was rejected", {
          tripId: trip.id, driverId, code: assignment.code,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      tripId: trip.id,
      assignmentApplied: Boolean(driverId) && !assignmentWarning,
      assignmentWarning,
      message: assignmentWarning
        ? "Trip created safely but left unassigned because the selected driver could not be reserved."
        : "Trip created successfully.",
    });
  } catch (error: unknown) {
    console.error("[admin-trip-create] unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not create trip. Please check the details and try again." },
      { status: 500 }
    );
  }
}
