import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromBearer } from "@/app/api/driver/utils";
import { advanceDriverOfferIfNeeded } from "@/lib/trip-offers";

const TRIP_SELECT =
  "id,status,offer_status,offer_expires_at,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,distance_km,duration_min,fare_amount";

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });

    const { data: mapping, error: mErr } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .single();

    if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });

    const driverId = mapping?.driver_id ?? null;
    if (!driverId) return NextResponse.json({ ok: false, error: "Not linked" }, { status: 403 });

    // Refresh subscription if expired
    await supabaseAdmin.rpc("refresh_driver_subscription", { did: driverId });

    // Check eligibility
    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id,online,status,subscription_status")
      .eq("id", driverId)
      .single();

    if (dErr || !driver) return NextResponse.json({ ok: false, error: "Driver record not found" }, { status: 404 });

    if (!driver.online) {
      return NextResponse.json({ ok: true, offers: [], info: "You are offline" });
    }

    if (driver.subscription_status !== "active" && driver.subscription_status !== "grace") {
      return NextResponse.json({ ok: true, offers: [], info: "Subscription inactive" });
    }

    const { data: activeRows, error } = await supabaseAdmin
      .from("driver_trip_offers")
      .select("trip_id")
      .eq("driver_id", driverId)
      .in("status", ["pending", "shown"])
      .limit(10);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    for (const row of activeRows ?? []) {
      if (row.trip_id) {
        await advanceDriverOfferIfNeeded(row.trip_id, driverId);
      }
    }

    const nowIso = new Date().toISOString();
    const { data: offers, error: offerErr } = await supabaseAdmin
      .from("driver_trip_offers")
      .select("trip_id,accept_deadline_at,offered_at")
      .eq("driver_id", driverId)
      .in("status", ["pending", "shown"])
      .gt("accept_deadline_at", nowIso)
      .order("offered_at", { ascending: false })
      .limit(5);

    if (offerErr) {
      return NextResponse.json({ ok: false, error: offerErr.message }, { status: 500 });
    }

    const tripIds = Array.from(new Set((offers ?? []).map((offer) => offer.trip_id).filter(Boolean)));

    if (tripIds.length === 0) {
      return NextResponse.json({ ok: true, offers: [] });
    }

    const { data: trips, error: fErr } = await supabaseAdmin
      .from("trips")
      .select(TRIP_SELECT)
      .in("id", tripIds)
      .eq("offer_status", "pending")
      .eq("status", "offered");

    if (fErr) return NextResponse.json({ ok: false, error: fErr.message }, { status: 500 });

    const deadlineByTripId = new Map(
      (offers ?? []).map((offer) => [offer.trip_id, offer.accept_deadline_at])
    );

    const fresh = (trips ?? [])
      .map((trip) => ({
        ...trip,
        offer_expires_at: deadlineByTripId.get(trip.id) ?? trip.offer_expires_at,
      }))
      .sort((a, b) => tripIds.indexOf(a.id) - tripIds.indexOf(b.id));

    return NextResponse.json({ ok: true, offers: fresh ?? [] });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
