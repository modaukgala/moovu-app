import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromBearer } from "@/app/api/driver/utils";
import {
  expirePendingOfferIfNeeded,
  isMissingOfferTableError,
  offerNextEligibleDriver,
} from "@/lib/trip-offers";

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

async function loadLegacyCurrentOffer(driverId: string) {
  const query = (columns: string) => supabaseAdmin
    .from("trips")
    .select(columns)
    .eq("driver_id", driverId)
    .eq("offer_status", "pending")
    .eq("status", "offered")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await query(TRIP_SELECT_WITH_STOPS);
  if (!error) return { offer: data ?? null, error: null };
  if (!isMissingStopsColumn(error)) return { offer: null, error };

  const fallback = await query(TRIP_SELECT);
  return { offer: fallback.data ?? null, error: fallback.error };
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
      if (isMissingOfferTableError(error)) {
        const { data: trips, error: legacyError } = await supabaseAdmin
          .from("trips")
          .select(TRIP_SELECT_WITH_STOPS)
          .eq("driver_id", driverId)
          .eq("offer_status", "pending")
          .eq("status", "offered")
          .order("created_at", { ascending: false })
          .limit(5);

        if (legacyError) {
          if (!isMissingStopsColumn(legacyError)) {
            return NextResponse.json({ ok: false, error: legacyError.message }, { status: 500 });
          }

          const { data: fallbackTrips, error: fallbackError } = await supabaseAdmin
            .from("trips")
            .select(TRIP_SELECT)
            .eq("driver_id", driverId)
            .eq("offer_status", "pending")
            .eq("status", "offered")
            .order("created_at", { ascending: false })
            .limit(5);

          if (fallbackError) {
            return NextResponse.json({ ok: false, error: fallbackError.message }, { status: 500 });
          }

          for (const trip of fallbackTrips ?? []) {
            const expired = await expirePendingOfferIfNeeded(trip.id);
            if (expired.expired) {
              const next = await offerNextEligibleDriver(trip.id, [driverId]);
              if (!next.ok) {
                await offerNextEligibleDriver(trip.id, [], {
                  excludePreviouslyAttempted: false,
                  resendToDriverId: driverId,
                });
              }
            }
          }
        }

        for (const trip of trips ?? []) {
          const expired = await expirePendingOfferIfNeeded(trip.id);
          if (expired.expired) {
            const next = await offerNextEligibleDriver(trip.id, [driverId]);
            if (!next.ok) {
              await offerNextEligibleDriver(trip.id, [], {
                excludePreviouslyAttempted: false,
                resendToDriverId: driverId,
              });
            }
          }
        }

        const { data: fresh, error: freshError } = await supabaseAdmin
          .from("trips")
          .select(TRIP_SELECT_WITH_STOPS)
          .eq("driver_id", driverId)
          .eq("offer_status", "pending")
          .eq("status", "offered")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (freshError) {
          if (!isMissingStopsColumn(freshError)) {
            return NextResponse.json({ ok: false, error: freshError.message }, { status: 500 });
          }

          const { data: legacyFresh, error: legacyFreshError } = await supabaseAdmin
            .from("trips")
            .select(TRIP_SELECT)
            .eq("driver_id", driverId)
            .eq("offer_status", "pending")
            .eq("status", "offered")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (legacyFreshError) {
            return NextResponse.json({ ok: false, error: legacyFreshError.message }, { status: 500 });
          }

          return NextResponse.json({ ok: true, offer: legacyFresh ?? null, mode: "legacy-trip-offer" });
        }

        return NextResponse.json({ ok: true, offer: fresh ?? null, mode: "legacy-trip-offer" });
      }

      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
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
      // Compatibility path: the legacy dispatcher stores the active offer on
      // trips even when driver_trip_offers exists but its atomic RPCs/columns
      // are not fully active yet.
      const legacy = await loadLegacyCurrentOffer(driverId);
      if (legacy.error) {
        return NextResponse.json({ ok: false, error: legacy.error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, offer: legacy.offer, mode: "legacy-trip-offer" });
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
      const legacy = await loadLegacyCurrentOffer(driverId);
      if (legacy.error) {
        return NextResponse.json({ ok: false, error: legacy.error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, offer: legacy.offer, mode: "legacy-trip-offer" });
    }

    return NextResponse.json({
      ok: true,
      offer: { ...trip, offer_expires_at: offerRow.accept_deadline_at },
    });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
