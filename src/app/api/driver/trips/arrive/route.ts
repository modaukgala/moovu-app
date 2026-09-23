import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  haversineKm,
  isFreshHeartbeat,
} from "@/lib/geo/tripGuards";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";
import { isOutboxDeliveryEnabled } from "@/lib/notifications/outboxDelivery";

function roundedKm(value: number | null) {
  return value == null ? null : Math.round(value * 100) / 100;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing access token." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const tripId = String(body?.tripId ?? "").trim();

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID is required." },
        { status: 400 }
      );
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mappingError || !mapping?.driver_id) {
      return NextResponse.json(
        { ok: false, error: "Driver account not linked." },
        { status: 400 }
      );
    }

    const driverId = mapping.driver_id;

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,status,driver_id,pickup_lat,pickup_lng")
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

    if (trip.driver_id !== driverId) {
      return NextResponse.json(
        { ok: false, error: "This trip is not assigned to you." },
        { status: 403 }
      );
    }

    if (trip.status !== "assigned") {
      return NextResponse.json(
        { ok: false, error: "Only assigned trips can be marked as arrived." },
        { status: 400 }
      );
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id,lat,lng,last_seen")
      .eq("id", driverId)
      .maybeSingle();

    if (driverError || !driver) {
      return NextResponse.json(
        { ok: false, error: "Driver not found." },
        { status: 404 }
      );
    }

    let kmAway: number | null = null;
    let distanceAudit = "Pickup distance audit unavailable.";

    if (driver.lat == null || driver.lng == null) {
      distanceAudit = "Driver marked arrived; GPS location was unavailable.";
    } else if (trip.pickup_lat == null || trip.pickup_lng == null) {
      distanceAudit = "Driver marked arrived; pickup coordinates were unavailable.";
    } else {
      kmAway = haversineKm(
        Number(driver.lat),
        Number(driver.lng),
        Number(trip.pickup_lat),
        Number(trip.pickup_lng)
      );

      const freshnessNote = isFreshHeartbeat(driver.last_seen)
        ? ""
        : " using last known GPS";
      distanceAudit = `Driver marked arrived ${kmAway.toFixed(2)} km from pickup${freshnessNote}.`;
    }

    const arrival = await callHardenedRpc<{
      trip_id: string;
      distance_m: number | null;
      location_age_seconds: number | null;
      no_show_evidence_qualified: boolean;
      replayed: boolean;
    }>(supabaseAdmin, "phase05b_mark_arrived", {
      p_trip_id: tripId,
      p_driver_id: driverId,
      p_actor_id: user.id,
      p_driver_lat: driver.lat == null ? null : Number(driver.lat),
      p_driver_lng: driver.lng == null ? null : Number(driver.lng),
      p_location_at: driver.last_seen,
    });
    if (!arrival.ok) {
      return NextResponse.json(
        { ok: false, error: arrival.error, code: arrival.code, referenceId: arrival.referenceId },
        { status: arrival.status },
      );
    }

    if (!arrival.result.replayed && !isOutboxDeliveryEnabled()) await notifyCustomerForTrip(
      tripId,
      "Driver Arrived",
      "Your driver has arrived at the pickup point.",
      `/ride/${tripId}`
    );

    if (!arrival.result.replayed && !isOutboxDeliveryEnabled()) await notifyAdmins(
      "Driver Arrived",
      `Driver arrived for trip ${tripId}.`,
      "/admin/trips"
    );

    return NextResponse.json({
      ok: true,
      message: "Trip marked as arrived.",
      kmAway: roundedKm(kmAway),
      distanceAudit,
      noShowEvidenceQualified: arrival.result.no_show_evidence_qualified,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
