import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { calculateFare } from "@/lib/fare/calculateFare";
import { normalizeRideOptionId } from "@/lib/domain/fare";
import { getActiveManualSurge } from "@/lib/pricing/manualSurgeServer";

const PAYMENT_METHODS = new Set(["cash", "online", "other"]);

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
    const distanceKm = Number(body?.distanceKm);
    const durationMin = body?.durationMin === "" || body?.durationMin == null ? null : Number(body.durationMin);
    const requestedFare = body?.fare == null || body?.fare === "" ? null : Number(body.fare);

    if (!pickup || !dropoff) {
      return NextResponse.json({ ok: false, error: "Pickup and dropoff are required." }, { status: 400 });
    }

    if (!PAYMENT_METHODS.has(paymentMethod)) {
      return NextResponse.json({ ok: false, error: "Invalid payment method." }, { status: 400 });
    }

    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      return NextResponse.json({ ok: false, error: "Distance is required." }, { status: 400 });
    }

    const activeSurge = await getActiveManualSurge();
    const fareAmount =
      requestedFare != null && Number.isFinite(requestedFare) && requestedFare > 0
        ? requestedFare
        : calculateFare({
            distanceKm,
            durationMin,
            rideOptionId,
            surgeLabel: activeSurge.mode,
            surgeMultiplier: activeSurge.multiplier,
          }).totalFare;

    const completionOtp = generateOtp();
    const initialStatus = driverId ? "assigned" : "requested";
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
        payment_method: paymentMethod,
        fare_amount: fareAmount,
        distance_km: distanceKm,
        duration_min: durationMin != null && Number.isFinite(durationMin) ? durationMin : null,
        ride_option: rideOptionId,
        status: initialStatus,
        driver_id: driverId || null,
        completion_otp: completionOtp,
        otp_verified: false,
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
      message: `Trip created. Rider OTP: ${completionOtp}. Surge: ${activeSurge.label}.`,
      old_status: null,
      new_status: trip.status,
      created_by: user.id,
    });

    if (driverId) {
      await supabaseAdmin.from("trip_events").insert({
        trip_id: trip.id,
        event_type: "assignment",
        message: `Assigned driver ${driverId}`,
        old_status: "requested",
        new_status: "assigned",
        created_by: user.id,
      });
    }

    return NextResponse.json({ ok: true, tripId: trip.id });
  } catch (error: unknown) {
    console.error("[admin-trip-create] unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not create trip. Please check the details and try again." },
      { status: 500 }
    );
  }
}
