import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { adminDriverName } from "@/lib/admin/identity";

type DispatchTripRow = {
  id: string;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  status: string;
  cancel_reason: string | null;
  created_at: string;
  offer_status: string | null;
  offer_expires_at: string | null;
  offer_attempted_driver_ids: string[] | null;
  dispatch_started_at?: string | null;
  dispatch_cycle?: number | null;
  dispatch_sequence?: number | null;
  dispatch_state?: string | null;
  dispatch_search_radius_km?: number | null;
  dispatch_failure_reason?: string | null;
};

type DispatchDriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  online: boolean | null;
  busy: boolean | null;
  subscription_status: string | null;
  last_seen: string | null;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const OPEN_TRIP_STATUSES = ["requested", "offered", "assigned", "arrived", "ongoing", "scheduled"];

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;

    const expandedTripsResult = await supabaseAdmin
      .from("trips")
      .select(`
        id,
        driver_id,
        pickup_address,
        dropoff_address,
        fare_amount,
        payment_method,
        status,
        cancel_reason,
        created_at,
        offer_status,
        offer_expires_at,
        offer_attempted_driver_ids,
        dispatch_started_at,
        dispatch_cycle,
        dispatch_sequence,
        dispatch_state,
        dispatch_search_radius_km,
        dispatch_failure_reason
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(300);

    let trips = expandedTripsResult.data as DispatchTripRow[] | null;
    let tErr = expandedTripsResult.error;

    if (expandedTripsResult.error?.code === "42703") {
      const fallbackTripsResult = await supabaseAdmin
        .from("trips")
        .select("id,driver_id,pickup_address,dropoff_address,fare_amount,payment_method,status,cancel_reason,created_at,offer_status,offer_expires_at,offer_attempted_driver_ids")
        .order("created_at", { ascending: false })
        .limit(300);
      trips = fallbackTripsResult.data as DispatchTripRow[] | null;
      tErr = fallbackTripsResult.error;
    }

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }

    // The recent feed above is intentionally capped, but open operational work
    // must never be displaced by newer closed trips.
    const openTripsResult = await supabaseAdmin
      .from("trips")
      .select(`
        id,
        driver_id,
        pickup_address,
        dropoff_address,
        fare_amount,
        payment_method,
        status,
        cancel_reason,
        created_at,
        offer_status,
        offer_expires_at,
        offer_attempted_driver_ids,
        dispatch_started_at,
        dispatch_cycle,
        dispatch_sequence,
        dispatch_state,
        dispatch_search_radius_km,
        dispatch_failure_reason
      `, { count: "exact" })
      .in("status", OPEN_TRIP_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1001);
    if (openTripsResult.error && openTripsResult.error.code !== "42703") {
      return NextResponse.json({ ok: false, error: openTripsResult.error.message }, { status: 500 });
    }
    const openTripsFallback = openTripsResult.error?.code === "42703"
      ? await supabaseAdmin
          .from("trips")
          .select("id,driver_id,pickup_address,dropoff_address,fare_amount,payment_method,status,cancel_reason,created_at,offer_status,offer_expires_at,offer_attempted_driver_ids", { count: "exact" })
          .in("status", OPEN_TRIP_STATUSES)
          .order("created_at", { ascending: false })
          .limit(1001)
      : null;
    if (openTripsFallback?.error) {
      return NextResponse.json({ ok: false, error: openTripsFallback.error.message }, { status: 500 });
    }
    const rawOpenTrips = (openTripsFallback?.data ?? openTripsResult.data ?? []) as DispatchTripRow[];
    const openTripCount = openTripsFallback?.count ?? openTripsResult.count ?? null;
    const openTripsComplete = openTripCount != null ? openTripCount <= 1000 : rawOpenTrips.length <= 1000;
    const visibleOpenTrips = rawOpenTrips.slice(0, 1000);
    const tripById = new Map<string, DispatchTripRow>();
    for (const trip of [
      ...visibleOpenTrips,
      ...((trips ?? []) as DispatchTripRow[]),
    ]) tripById.set(trip.id, trip);
    trips = [...tripById.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));

    const driverIds = Array.from(
      new Set(
        ((trips ?? []) as DispatchTripRow[])
          .map((trip) => trip.driver_id)
          .filter((driverId): driverId is string => Boolean(driverId))
      )
    );

    let driversById: Record<string, DispatchDriverRow> = {};

    if (driverIds.length > 0) {
      const { data: drivers, error: dErr } = await supabaseAdmin
        .from("drivers")
        .select("id, first_name, last_name, phone, online, busy, subscription_status,last_seen")
        .in("id", driverIds);

      if (dErr) {
        return NextResponse.json({ ok: false, error: dErr.message }, { status: 500 });
      }

      driversById = Object.fromEntries(
        ((drivers ?? []) as DispatchDriverRow[]).map((driver) => [driver.id, driver])
      );
    }

    const attemptsByTrip = new Map<string, Set<string>>();
    const offersByTrip = new Map<string, Array<Record<string, unknown>>>();
    const tripIds = (trips ?? []).map(trip => trip.id);
    if (tripIds.length) {
      // Page canonical rows instead of trusting the unused legacy array or the
      // Data API's default row limit. This count is informational, not authority.
      for (let offset = 0; ; offset += 1000) {
        const attemptResult = await supabaseAdmin.from("driver_trip_offers")
          .select("id,trip_id,driver_id,status,offered_at,responded_at,expired_at,accept_deadline_at,decline_reason,response_source,dispatch_cycle,sequence_number")
          .in("trip_id", tripIds).order("offered_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 999);
        if (attemptResult.error) {
          console.error("[dispatch-board] attempt history unavailable", attemptResult.error);
          return NextResponse.json({ ok: false, error: "Dispatch offer history is unavailable." }, { status: 503 });
        }
        for (const attempt of attemptResult.data ?? []) {
          const ids = attemptsByTrip.get(attempt.trip_id) ?? new Set<string>();
          ids.add(attempt.driver_id);
          attemptsByTrip.set(attempt.trip_id, ids);
          const offers = offersByTrip.get(attempt.trip_id) ?? [];
          offers.push(attempt);
          offersByTrip.set(attempt.trip_id, offers);
        }
        if ((attemptResult.data ?? []).length < 1000) break;
      }
    }
    const rows = ((trips ?? []) as DispatchTripRow[]).map((trip) => {
      const driver = trip.driver_id ? driversById[trip.driver_id] : null;
      return {
        ...trip,
        driver: driver
          ? {
              id: driver.id,
              name: adminDriverName(driver),
              phone: driver.phone ?? null,
              online: driver.online ?? null,
              busy: driver.busy ?? null,
              subscription_status: driver.subscription_status ?? null,
              last_seen: driver.last_seen ?? null,
            }
          : null,
        attempted_count: attemptsByTrip.get(trip.id)?.size ?? 0,
        offers: offersByTrip.get(trip.id) ?? [],
      };
    });

    return NextResponse.json({
      ok: true,
      rows,
      retrieval: {
        openTripsComplete,
        openTripsTotal: openTripCount,
        openTripsVisible: visibleOpenTrips.length,
        warning: openTripsComplete ? null : "Open dispatch retrieval reached 1,000 trips. The board is incomplete; use narrower operational filters or investigate the queue size.",
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
