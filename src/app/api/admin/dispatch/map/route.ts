import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

const ACTIVE_TRIP_STATUSES = ["offered", "assigned", "arrived", "ongoing"];

type MapDriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  online: boolean | null;
  busy: boolean | null;
  status?: string | null;
  subscription_status: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  last_seen?: string | null;
};

type MapTripRow = {
  id: string;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | string;
  pickup_lng: number | string;
  dropoff_lat: number | string | null;
  dropoff_lng: number | string | null;
  fare_amount: number | null;
  status: string;
  offer_status: string | null;
  created_at: string;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;

    const { data: drivers, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select(
        "id,first_name,last_name,phone,online,busy,status,subscription_status,lat,lng,last_seen"
      )
      .eq("online", true)
      .not("lat", "is", null)
      .not("lng", "is", null)
      .order("last_seen", { ascending: false })
      .limit(500);

    if (dErr) {
      return NextResponse.json({ ok: false, error: dErr.message }, { status: 500 });
    }

    const { data: trips, error: tErr } = await supabaseAdmin
      .from("trips")
      .select(
        "id,driver_id,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,fare_amount,status,offer_status,created_at"
      )
      .in("status", ACTIVE_TRIP_STATUSES)
      .not("pickup_lat", "is", null)
      .not("pickup_lng", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }

    const driverIds = Array.from(
      new Set(
        ((trips ?? []) as MapTripRow[])
          .map((trip) => trip.driver_id)
          .filter((driverId): driverId is string => Boolean(driverId))
      )
    );

    let tripDriversById: Record<string, MapDriverRow> = {};
    if (driverIds.length > 0) {
      const { data: tripDrivers, error: tdErr } = await supabaseAdmin
        .from("drivers")
        .select("id,first_name,last_name,phone,online,busy,subscription_status")
        .in("id", driverIds);

      if (tdErr) {
        return NextResponse.json({ ok: false, error: tdErr.message }, { status: 500 });
      }

      tripDriversById = Object.fromEntries(
        ((tripDrivers ?? []) as MapDriverRow[]).map((driver) => [driver.id, driver])
      );
    }

    const driverRows = ((drivers ?? []) as MapDriverRow[]).map((driver) => ({
      id: driver.id,
      name: `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || "Unnamed",
      phone: driver.phone ?? null,
      online: driver.online ?? null,
      busy: driver.busy ?? null,
      status: driver.status ?? null,
      subscription_status: driver.subscription_status ?? null,
      lat: Number(driver.lat),
      lng: Number(driver.lng),
      last_seen: driver.last_seen ?? null,
    }));

    const tripRows = ((trips ?? []) as MapTripRow[]).map((trip) => ({
      id: trip.id,
      driver_id: trip.driver_id ?? null,
      pickup_address: trip.pickup_address ?? null,
      dropoff_address: trip.dropoff_address ?? null,
      pickup_lat: Number(trip.pickup_lat),
      pickup_lng: Number(trip.pickup_lng),
      dropoff_lat: trip.dropoff_lat != null ? Number(trip.dropoff_lat) : null,
      dropoff_lng: trip.dropoff_lng != null ? Number(trip.dropoff_lng) : null,
      fare_amount: trip.fare_amount ?? null,
      status: trip.status,
      offer_status: trip.offer_status ?? null,
      created_at: trip.created_at,
      driver:
        trip.driver_id && tripDriversById[trip.driver_id]
          ? {
              id: tripDriversById[trip.driver_id].id,
              name:
                `${tripDriversById[trip.driver_id].first_name ?? ""} ${tripDriversById[trip.driver_id].last_name ?? ""}`.trim() ||
                "Unnamed",
              phone: tripDriversById[trip.driver_id].phone ?? null,
              online: tripDriversById[trip.driver_id].online ?? null,
              busy: tripDriversById[trip.driver_id].busy ?? null,
              subscription_status: tripDriversById[trip.driver_id].subscription_status ?? null,
            }
          : null,
    }));

    return NextResponse.json({
      ok: true,
      drivers: driverRows,
      trips: tripRows,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error") },
      { status: 500 }
    );
  }
}
