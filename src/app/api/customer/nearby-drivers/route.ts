import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { haversineKm } from "@/lib/dispatch/driverScoring";
import { DRIVER_COMMISSION_LOCK_LIMIT } from "@/lib/finance/commission";
import { LIVE_LOCATION_CONFIG } from "@/lib/location/liveLocationConfig";

type NearbyDriverRow = {
  id: string;
  status: string | null;
  verification_status: string | null;
  profile_completed: boolean | null;
  busy: boolean | null;
  lat: number | null;
  lng: number | null;
  last_seen: string | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
  seating_capacity: number | null;
  is_deleted: boolean | null;
};

function numberParam(url: URL, name: string) {
  const value = Number(url.searchParams.get(name));
  return Number.isFinite(value) ? value : null;
}

export async function GET(req: Request) {
  const auth = await getAuthenticatedCustomer(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const lat = numberParam(url, "lat");
  const lng = numberParam(url, "lng");
  const rideOption = url.searchParams.get("rideOption") === "group" ? "group" : "go";
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ ok: false, error: "Valid map coordinates are required." }, { status: 400 });
  }

  const now = Date.now();
  const freshAfter = new Date(
    now - LIVE_LOCATION_CONFIG.customerDriverStaleSeconds * 1000,
  ).toISOString();
  const driverResult = await auth.supabaseAdmin
    .from("drivers")
    .select("id,status,verification_status,profile_completed,busy,lat,lng,last_seen,subscription_status,subscription_expires_at,seating_capacity,is_deleted")
    .eq("online", true)
    .eq("busy", false)
    .gte("last_seen", freshAfter)
    .limit(150);

  if (driverResult.error) {
    console.error("[nearby-drivers] driver lookup failed", driverResult.error);
    return NextResponse.json({ ok: false, error: "Nearby drivers are temporarily unavailable." }, { status: 500 });
  }

  const prelim = ((driverResult.data ?? []) as NearbyDriverRow[]).filter((driver) => {
    if (driver.is_deleted || driver.lat == null || driver.lng == null) return false;
    if (!["approved", "active"].includes(String(driver.status ?? ""))) return false;
    if (driver.verification_status && driver.verification_status !== "approved") return false;
    if (driver.profile_completed === false) return false;
    if (!["active", "grace"].includes(String(driver.subscription_status ?? ""))) return false;
    if (!driver.subscription_expires_at || new Date(driver.subscription_expires_at).getTime() <= now) return false;
    if (Number(driver.seating_capacity ?? 0) < (rideOption === "group" ? 6 : 3)) return false;
    return haversineKm(lat, lng, Number(driver.lat), Number(driver.lng)) <=
      LIVE_LOCATION_CONFIG.customerDriverRadiusKm;
  });

  if (prelim.length === 0) {
    return NextResponse.json({ ok: true, drivers: [] });
  }

  const driverIds = prelim.map((driver) => driver.id);
  const [wallets, activeTrips] = await Promise.all([
    auth.supabaseAdmin.from("driver_wallets").select("driver_id,balance_due").in("driver_id", driverIds),
    auth.supabaseAdmin
      .from("trips")
      .select("driver_id")
      .in("driver_id", driverIds)
      .in("status", ["assigned", "arrived", "ongoing"]),
  ]);
  if (wallets.error || activeTrips.error) {
    console.error("[nearby-drivers] eligibility lookup failed", {
      wallets: wallets.error?.message,
      activeTrips: activeTrips.error?.message,
    });
    return NextResponse.json({ ok: true, drivers: [] });
  }
  const locked = new Set(
    (wallets.data ?? [])
      .filter((row) => Number(row.balance_due ?? 0) >= DRIVER_COMMISSION_LOCK_LIMIT)
      .map((row) => String(row.driver_id)),
  );
  const active = new Set((activeTrips.data ?? []).map((row) => String(row.driver_id)));

  const drivers = prelim
    .filter((driver) => !locked.has(driver.id) && !active.has(driver.id))
    .map((driver) => ({
      markerId: createHash("sha256").update(driver.id).digest("hex").slice(0, 16),
      lat: Number(Number(driver.lat).toFixed(4)),
      lng: Number(Number(driver.lng).toFixed(4)),
      updatedAt: driver.last_seen,
    }));

  return NextResponse.json(
    { ok: true, drivers },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
