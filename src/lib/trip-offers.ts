import { supabaseAdmin } from "@/lib/supabase/admin";

const OFFER_SECONDS = 20;

function approxKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function uniqStrings(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

export async function expirePendingOfferIfNeeded(tripId: string) {
  const { data: trip } = await supabaseAdmin
    .from("trips")
    .select("id,status,driver_id,offer_status,offer_expires_at,offer_attempted_driver_ids")
    .eq("id", tripId)
    .single();

  if (!trip) return { expired: false, trip: null };

  if (trip.offer_status !== "pending" || !trip.offer_expires_at) {
    return { expired: false, trip };
  }

  const exp = new Date(trip.offer_expires_at).getTime();
  if (Date.now() <= exp) {
    return { expired: false, trip };
  }

  const attempted = uniqStrings([
    ...((trip.offer_attempted_driver_ids ?? []) as string[]),
    ...(trip.driver_id ? [trip.driver_id] : []),
  ]);

  if (trip.driver_id) {
    await supabaseAdmin.from("drivers").update({ busy: false }).eq("id", trip.driver_id);
  }

  await supabaseAdmin
    .from("trips")
    .update({
      driver_id: null,
      status: "requested",
      offer_status: "expired",
      offer_expires_at: null,
      offer_attempted_driver_ids: attempted,
    })
    .eq("id", tripId);

  await supabaseAdmin.from("trip_events").insert({
    trip_id: tripId,
    event_type: "offer_expired",
    message: "Offer expired (no response)",
    old_status: "offered",
    new_status: "requested",
  });

  return {
    expired: true,
    trip: {
      ...trip,
      offer_attempted_driver_ids: attempted,
      driver_id: null,
      status: "requested",
      offer_status: "expired",
      offer_expires_at: null,
    },
  };
}

export async function offerNextEligibleDriver(
  tripId: string,
  extraExcludeDriverIds: string[] = []
) {
  // 1) Expire current pending offer first if needed
  const expireResult = await expirePendingOfferIfNeeded(tripId);

  // 2) Load fresh trip
  const { data: trip, error: tripErr } = await supabaseAdmin
    .from("trips")
    .select(
      "id,status,driver_id,pickup_lat,pickup_lng,offer_status,offer_expires_at,offer_attempted_driver_ids"
    )
    .eq("id", tripId)
    .single();

  if (tripErr || !trip) {
    return { ok: false as const, error: tripErr?.message ?? "Trip not found" };
  }

  if (trip.status === "cancelled" || trip.status === "completed") {
    return { ok: false as const, error: "Trip is closed" };
  }

  if (trip.offer_status === "pending" && trip.driver_id && trip.offer_expires_at) {
    return {
      ok: true as const,
      alreadyPending: true,
      driverId: trip.driver_id,
      offer_expires_at: trip.offer_expires_at,
      status: "offered",
    };
  }

  if (trip.status !== "requested") {
    return {
      ok: false as const,
      error: `Trip must be 'requested' to offer next driver. Current: ${trip.status}`,
    };
  }

  if (trip.pickup_lat == null || trip.pickup_lng == null) {
    return { ok: false as const, error: "Trip missing pickup coordinates" };
  }

  const excluded = uniqStrings([
    ...((trip.offer_attempted_driver_ids ?? []) as string[]),
    ...extraExcludeDriverIds,
  ]);

  // 3) Load eligible drivers
  const { data: drivers, error: dErr } = await supabaseAdmin
    .from("drivers")
    .select("id,lat,lng,online,busy,status,subscription_status,subscription_expires_at")
    .eq("online", true)
    .eq("busy", false)
    .in("status", ["approved", "active"])
    .in("subscription_status", ["active", "grace"]);

  if (dErr) return { ok: false as const, error: dErr.message };

  // Safety: flip expired active/grace to inactive
  for (const d of drivers ?? []) {
    if (
      d.subscription_expires_at &&
      (d.subscription_status === "active" || d.subscription_status === "grace") &&
      Date.now() > new Date(d.subscription_expires_at).getTime()
    ) {
      await supabaseAdmin.from("drivers").update({ subscription_status: "inactive" }).eq("id", d.id);
    }
  }

  const usable = (drivers ?? [])
    .filter((d: any) => typeof d.lat === "number" && typeof d.lng === "number")
    .filter((d: any) => !excluded.includes(d.id))
    .filter((d: any) => d.subscription_status === "active" || d.subscription_status === "grace");

  if (usable.length === 0) {
    return {
      ok: false as const,
      error: "No more eligible online drivers (active subscription required)",
      exhausted: true,
      excluded,
    };
  }

  // 4) Find nearest
  let best = usable[0];
  let bestKm = approxKm(trip.pickup_lat, trip.pickup_lng, best.lat, best.lng);

  for (const d of usable.slice(1)) {
    const km = approxKm(trip.pickup_lat, trip.pickup_lng, d.lat, d.lng);
    if (km < bestKm) {
      best = d;
      bestKm = km;
    }
  }

  // 5) Lock driver
  const { error: lockErr } = await supabaseAdmin.from("drivers").update({ busy: true }).eq("id", best.id);
  if (lockErr) return { ok: false as const, error: lockErr.message };

  // 6) Offer trip
  const expiresAt = new Date(Date.now() + OFFER_SECONDS * 1000).toISOString();
  const attempted = uniqStrings([...(trip.offer_attempted_driver_ids ?? []), best.id]);

  const { error: upTripErr } = await supabaseAdmin
    .from("trips")
    .update({
      driver_id: best.id,
      status: "offered",
      offer_status: "pending",
      offer_expires_at: expiresAt,
      offer_attempted_driver_ids: attempted,
    })
    .eq("id", tripId);

  if (upTripErr) {
    await supabaseAdmin.from("drivers").update({ busy: false }).eq("id", best.id);
    return { ok: false as const, error: upTripErr.message };
  }

  await supabaseAdmin.from("trip_events").insert({
    trip_id: tripId,
    event_type: "offer_sent",
    message: `Offered to driver ${best.id} (expires in ${OFFER_SECONDS}s, ≈ ${bestKm.toFixed(
      2
    )} km away)`,
    old_status: "requested",
    new_status: "offered",
  });

  return {
    ok: true as const,
    driverId: best.id,
    approxKm: Math.round(bestKm * 100) / 100,
    offer_expires_at: expiresAt,
    status: "offered",
    attempted,
    expiredPrevious: expireResult.expired,
  };
}