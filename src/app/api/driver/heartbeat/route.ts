import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordTripTelemetry } from "@/lib/trips/recordTripTelemetry";

type DriverReadinessCacheEntry = {
  online: boolean;
  subscriptionStatus: string | null;
  checkedAt: number;
};

type DriverHeartbeatCache = {
  driverIdByUserId: Map<string, string>;
  subscriptionRefreshAt: Map<string, number>;
  readinessByDriverId: Map<string, DriverReadinessCacheEntry>;
};

declare global {
  var __moovuDriverHeartbeatCache: DriverHeartbeatCache | undefined;
}

function heartbeatCache() {
  if (!globalThis.__moovuDriverHeartbeatCache) {
    globalThis.__moovuDriverHeartbeatCache = {
      driverIdByUserId: new Map(),
      subscriptionRefreshAt: new Map(),
      readinessByDriverId: new Map(),
    };
  }

  return globalThis.__moovuDriverHeartbeatCache;
}

const SUBSCRIPTION_REFRESH_MS = 60_000;
const READINESS_CACHE_MS = 15_000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error";
}

async function getUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

function isValidLatLng(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }

    const { lat, lng, heading, speedMps, accuracyM, capturedAt } = await req.json();

    if (typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ ok: false, error: "lat/lng must be numbers" }, { status: 400 });
    }

    if (!isValidLatLng(lat, lng)) {
      return NextResponse.json({ ok: false, error: "Invalid coordinates" }, { status: 400 });
    }

    const cache = heartbeatCache();
    let driverId = cache.driverIdByUserId.get(user.id) ?? null;
    if (!driverId) {
      const { data: mapping, error: mErr } = await supabaseAdmin
        .from("driver_accounts")
        .select("driver_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (mErr) {
        return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
      }

      driverId = mapping?.driver_id ?? null;
      if (driverId) {
        cache.driverIdByUserId.set(user.id, driverId);
      }
    }

    if (!driverId) {
      return NextResponse.json({ ok: false, code: "NOT_LINKED", error: "Not linked" }, { status: 403 });
    }

    const now = Date.now();
    const lastSubscriptionRefresh = cache.subscriptionRefreshAt.get(driverId) ?? 0;
    if (now - lastSubscriptionRefresh >= SUBSCRIPTION_REFRESH_MS) {
      await supabaseAdmin.rpc("refresh_driver_subscription", { did: driverId });
      cache.subscriptionRefreshAt.set(driverId, now);
      cache.readinessByDriverId.delete(driverId);
    }

    let readiness = cache.readinessByDriverId.get(driverId) ?? null;
    if (!readiness || now - readiness.checkedAt >= READINESS_CACHE_MS) {
      const { data: driver, error: dErr } = await supabaseAdmin
        .from("drivers")
        .select("id,online,subscription_status")
        .eq("id", driverId)
        .maybeSingle();

      if (dErr || !driver) {
        return NextResponse.json({ ok: false, error: "Driver not found" }, { status: 404 });
      }

      readiness = {
        online: Boolean(driver.online),
        subscriptionStatus: driver.subscription_status ?? null,
        checkedAt: now,
      };
      cache.readinessByDriverId.set(driverId, readiness);
    }

    if (!readiness.online) {
      return NextResponse.json({ ok: false, error: "Driver is offline" }, { status: 400 });
    }

    if (readiness.subscriptionStatus !== "active" && readiness.subscriptionStatus !== "grace") {
      return NextResponse.json({ ok: false, error: "Subscription inactive" }, { status: 402 });
    }

    const { error: upErr } = await supabaseAdmin
      .from("drivers")
      .update({
        lat,
        lng,
        last_seen: new Date().toISOString(),
      })
      .eq("id", driverId);

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    const telemetry = await recordTripTelemetry({
      supabase: supabaseAdmin,
      driverId,
      lat,
      lng,
      heading: typeof heading === "number" ? heading : null,
      speedMps: typeof speedMps === "number" ? speedMps : null,
      accuracyM: typeof accuracyM === "number" ? accuracyM : null,
      capturedAt: typeof capturedAt === "string" ? capturedAt : undefined,
    });
    if (!telemetry.ok) {
      console.error("[driver-heartbeat] trip telemetry failed", { driverId, reason: telemetry.error });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
