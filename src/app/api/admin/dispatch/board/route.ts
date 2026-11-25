import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

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

    const params = new URL(req.url).searchParams;
    const parsePage = (key: string) => {
      const value = Number(params.get(key) ?? 1);
      return Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000 ? value : 1;
    };
    const openPage = parsePage("openPage");
    const closedPage = parsePage("closedPage");
    const pageSize = 50;
    const query = (params.get("q") ?? "").trim().slice(0, 160);
    const status = params.get("status");
    const queue = params.get("queue");
    const base = "id,driver_id,pickup_address,dropoff_address,fare_amount,payment_method,status,cancel_reason,created_at,offer_status,offer_expires_at,offer_attempted_driver_ids";
    const extended = base + ",dispatch_started_at,dispatch_cycle,dispatch_sequence,dispatch_state,dispatch_search_radius_km,dispatch_failure_reason";
    const readTrips = async (open: boolean, page: number, columns: string) => {
      let read = supabaseAdmin.from("trips").select(columns, { count: "exact" });
      read = open ? read.in("status", OPEN_TRIP_STATUSES) : read.not("status", "in", `(${OPEN_TRIP_STATUSES.join(",")})`);
      if (queue === "active") read = read.in("status", ["requested", "offered", "assigned", "arrived", "ongoing"]);
      if (queue === "unassigned") read = read.in("status", ["requested", "offered"]).is("driver_id", null);
      if (status && status !== "all") read = read.eq("status", status);
      if (query) {
        const literal = query.replace(/[\\%_*]/g, "\\$&").replace(/["\\]/g, "\\$&");
        const addresses = ["pickup_address", "dropoff_address"].map((key) => key + '.ilike."%' + literal + '%"');
        if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(query)) addresses.push(`id.eq.${query}`);
        read = read.or(addresses.join(","));
      }
      return await read.order("created_at", { ascending: false }).order("id", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);
    };
    const loadPage = async (open: boolean, page: number) => {
      const result = await readTrips(open, page, extended);
      return result.error?.code === "42703" ? readTrips(open, page, base) : result;
    };
    const [open, closed] = await Promise.all([loadPage(true, openPage), loadPage(false, closedPage)]);
    if (open.error || closed.error) {
      return NextResponse.json({ ok: false, error: open.error?.message ?? closed.error?.message }, { status: 500 });
    }
    const openRows = (open.data ?? []) as unknown as DispatchTripRow[];
    const closedRows = (closed.data ?? []) as unknown as DispatchTripRow[];
    const trips = [...openRows, ...closedRows];

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
              name: `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || "Unnamed",
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
        pageSize, openPage, closedPage,
        openTripsTotal: open.count, closedTripsTotal: closed.count,
        openTripsVisible: openRows.length, closedTripsVisible: closedRows.length,
        warning: open.count == null || closed.count == null ? "Some filtered totals are unavailable." : null,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
