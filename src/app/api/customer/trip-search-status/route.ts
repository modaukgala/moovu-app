import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";

const SEARCH_WINDOW_SECONDS = 30 * 60;
const NEARBY_KM = 20;
const FRESH_MINUTES = 10;

function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Transparent "searching for a driver" progress for the customer's own trip. Read-only. */
export async function GET(req: Request) {
  const auth = await getAuthenticatedCustomer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const tripId = String(new URL(req.url).searchParams.get("tripId") ?? "").trim();
  if (!tripId) return NextResponse.json({ ok: false, error: "Missing tripId" }, { status: 400 });

  const db = auth.supabaseAdmin;
  const { data: trip } = await db.from("trips")
    .select("id,status,driver_id,pickup_lat,pickup_lng,created_at,dispatch_started_at,dispatch_cycle")
    .eq("id", tripId).eq("customer_id", auth.customer.id).maybeSingle();
  if (!trip) return NextResponse.json({ ok: false, error: "Trip not found" }, { status: 404 });

  const searching = ["requested", "offered"].includes(String(trip.status)) && !trip.driver_id;
  const startedAt = trip.dispatch_started_at ?? trip.created_at;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));

  const { data: offers } = await db.from("driver_trip_offers").select("driver_id").eq("trip_id", tripId);
  const driversOffered = new Set((offers ?? []).map((o) => String(o.driver_id))).size;

  let driversNearby = 0;
  if (searching && trip.pickup_lat != null && trip.pickup_lng != null) {
    const fresh = new Date(Date.now() - FRESH_MINUTES * 60_000).toISOString();
    const { data: drivers } = await db.from("drivers").select("lat,lng")
      .eq("online", true).eq("busy", false).gte("last_seen", fresh).limit(300);
    driversNearby = (drivers ?? []).filter((d) => d.lat != null && d.lng != null &&
      km(Number(trip.pickup_lat), Number(trip.pickup_lng), Number(d.lat), Number(d.lng)) <= NEARBY_KM).length;
  }

  return NextResponse.json({
    ok: true,
    searching,
    elapsedSeconds,
    remainingSeconds: Math.max(0, SEARCH_WINDOW_SECONDS - elapsedSeconds),
    round: Math.max(1, Number(trip.dispatch_cycle ?? 1)),
    driversOffered,
    driversNearby,
  });
}
