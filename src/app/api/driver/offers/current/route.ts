import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromBearer } from "@/app/api/driver/utils";

const TRIP_SELECT =
  "id,status,offer_status,offer_expires_at,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,distance_km,duration_min,fare_amount,payment_method";
const TRIP_SELECT_WITH_STOPS =
  `${TRIP_SELECT},ride_option,stops,original_fare,final_add_stop_increase,final_fare,stop_waiting_fee`;

function isMissingStopsColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42703" && (
    message.includes("stops") ||
    message.includes("original_fare") ||
    message.includes("final_add_stop_increase") ||
    message.includes("final_fare") ||
    message.includes("stop_waiting_fee") ||
    message.includes("ride_option")
  );
}

export async function GET(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }

    const { data: mapping, error: mErr } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mErr) {
      return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
    }

    const driverId = mapping?.driver_id ?? null;
    if (!driverId) {
      return NextResponse.json({
        ok: false,
        code: "NOT_LINKED",
        error: "Your account is not linked to a driver yet.",
      });
    }

    await supabaseAdmin.rpc("refresh_driver_subscription", { did: driverId });

    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id,online,status,subscription_status")
      .eq("id", driverId)
      .maybeSingle();

    if (dErr || !driver) {
      return NextResponse.json({ ok: false, error: "Driver record not found" }, { status: 404 });
    }

    if (!driver.online) {
      return NextResponse.json({ ok: true, offer: null, info: "You are offline" });
    }

    if (driver.subscription_status !== "active" && driver.subscription_status !== "grace") {
      return NextResponse.json({ ok: true, offer: null, info: "Subscription inactive" });
    }

    const { error } = await supabaseAdmin
      .from("driver_trip_offers")
      .select("trip_id")
      .eq("driver_id", driverId)
      .in("status", ["pending", "shown"])
      .limit(10);

    if (error) {
      console.error("[driver-offers] atomic offer table unavailable", { reason: error.message });
      return NextResponse.json(
        { ok: false, error: "Atomic dispatch migration is not active." },
        { status: 503 },
      );
    }

    // The client only reads offers. The protected dispatch worker owns
    // escalation and expiry when the atomic offer table is available.

    const nowIso = new Date().toISOString();
    const { data: offers, error: offerErr } = await supabaseAdmin
      .from("driver_trip_offers")
      .select("trip_id,accept_deadline_at,offered_at")
      .eq("driver_id", driverId)
      .in("status", ["pending", "shown"])
      .gt("accept_deadline_at", nowIso)
      .order("offered_at", { ascending: false })
      .limit(1);

    if (offerErr) {
      return NextResponse.json({ ok: false, error: offerErr.message }, { status: 500 });
    }

    const offerRow = offers?.[0] ?? null;
    if (!offerRow?.trip_id) {
      return NextResponse.json({ ok: true, offer: null });
    }

    const { data: trip, error: tripErr } = await supabaseAdmin
      .from("trips")
      .select(TRIP_SELECT_WITH_STOPS)
      .eq("id", offerRow.trip_id)
      .maybeSingle();

    if (tripErr) {
      if (!isMissingStopsColumn(tripErr)) {
        return NextResponse.json({ ok: false, error: tripErr.message }, { status: 500 });
      }

      const { data: legacyTrip, error: legacyTripErr } = await supabaseAdmin
        .from("trips")
        .select(TRIP_SELECT)
        .eq("id", offerRow.trip_id)
        .maybeSingle();

      if (legacyTripErr) {
        return NextResponse.json({ ok: false, error: legacyTripErr.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        offer: legacyTrip ? { ...legacyTrip, offer_expires_at: offerRow.accept_deadline_at } : null,
      });
    }

    if (!trip || ["assigned", "arrived", "ongoing", "completed", "cancelled"].includes(String(trip.status ?? "").toLowerCase())) {
      return NextResponse.json({ ok: true, offer: null });
    }

    return NextResponse.json({
      ok: true,
      offer: { ...trip, offer_expires_at: offerRow.accept_deadline_at },
    });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
