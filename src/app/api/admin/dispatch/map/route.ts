import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ACTIVE_TRIP_STATUSES = ["offered", "assigned", "arrived", "ongoing"];

export async function GET() {
  try {
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
      new Set((trips ?? []).map((t: any) => t.driver_id).filter(Boolean))
    );

    let tripDriversById: Record<string, any> = {};
    if (driverIds.length > 0) {
      const { data: tripDrivers, error: tdErr } = await supabaseAdmin
        .from("drivers")
        .select("id,first_name,last_name,phone,online,busy,subscription_status")
        .in("id", driverIds);

      if (tdErr) {
        return NextResponse.json({ ok: false, error: tdErr.message }, { status: 500 });
      }

      tripDriversById = Object.fromEntries((tripDrivers ?? []).map((d: any) => [d.id, d]));
    }

    const driverRows = (drivers ?? []).map((d: any) => ({
      id: d.id,
      name: `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed",
      phone: d.phone ?? null,
      online: d.online ?? null,
      busy: d.busy ?? null,
      status: d.status ?? null,
      subscription_status: d.subscription_status ?? null,
      lat: Number(d.lat),
      lng: Number(d.lng),
      last_seen: d.last_seen ?? null,
    }));

    const tripRows = (trips ?? []).map((t: any) => ({
      id: t.id,
      driver_id: t.driver_id ?? null,
      pickup_address: t.pickup_address ?? null,
      dropoff_address: t.dropoff_address ?? null,
      pickup_lat: Number(t.pickup_lat),
      pickup_lng: Number(t.pickup_lng),
      dropoff_lat: t.dropoff_lat != null ? Number(t.dropoff_lat) : null,
      dropoff_lng: t.dropoff_lng != null ? Number(t.dropoff_lng) : null,
      fare_amount: t.fare_amount ?? null,
      status: t.status,
      offer_status: t.offer_status ?? null,
      created_at: t.created_at,
      driver:
        t.driver_id && tripDriversById[t.driver_id]
          ? {
              id: tripDriversById[t.driver_id].id,
              name:
                `${tripDriversById[t.driver_id].first_name ?? ""} ${tripDriversById[t.driver_id].last_name ?? ""}`.trim() ||
                "Unnamed",
              phone: tripDriversById[t.driver_id].phone ?? null,
              online: tripDriversById[t.driver_id].online ?? null,
              busy: tripDriversById[t.driver_id].busy ?? null,
              subscription_status: tripDriversById[t.driver_id].subscription_status ?? null,
            }
          : null,
    }));

    return NextResponse.json({
      ok: true,
      drivers: driverRows,
      trips: tripRows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}