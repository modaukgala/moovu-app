import { createClient } from "@supabase/supabase-js";
import { sendPushToTargets } from "@/lib/push-server";
import { expireDriverSubscriptions } from "@/lib/subscriptions/expireDriverSubscriptions";

type DriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  online: boolean | null;
  busy: boolean | null;
  lat: number | null;
  lng: number | null;
  verification_status: string | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
};

function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function canTakeTrips(driver: DriverRow) {
  const expiryMs = driver.subscription_expires_at
    ? new Date(driver.subscription_expires_at).getTime()
    : null;

  const subscriptionValid =
    driver.subscription_status === "active" &&
    expiryMs != null &&
    expiryMs > Date.now();

  return (
    driver.online === true &&
    driver.busy === false &&
    driver.lat != null &&
    driver.lng != null &&
    (driver.verification_status === "approved" ||
      driver.verification_status === null) &&
    subscriptionValid
  );
}

export async function offerNextDriver(params: {
  tripId: string;
  excludeDriverIds?: string[];
}) {
  await expireDriverSubscriptions().catch(() => {});

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const exclude = Array.from(new Set((params.excludeDriverIds ?? []).filter(Boolean)));

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select(`
      id,
      status,
      driver_id,
      pickup_address,
      dropoff_address,
      pickup_lat,
      pickup_lng
    `)
    .eq("id", params.tripId)
    .maybeSingle();

  if (tripError) {
    return { ok: false as const, error: tripError.message };
  }

  if (!trip) {
    return { ok: false as const, error: "Trip not found." };
  }

  if (trip.pickup_lat == null || trip.pickup_lng == null) {
    return { ok: false as const, error: "Trip pickup coordinates are missing." };
  }

  const { data: alreadyTriedRows } = await supabase
    .from("trip_events")
    .select("message")
    .eq("trip_id", params.tripId)
    .in("event_type", [
      "driver_offer_sent_auto",
      "driver_offer_sent_rollover",
      "offer_declined",
      "offer_expired",
    ]);

  const triedDriverIds = new Set<string>(exclude);

  if (trip.driver_id) {
    triedDriverIds.add(trip.driver_id);
  }

  for (const row of alreadyTriedRows ?? []) {
    const msg = String((row as any)?.message ?? "");
    const match = msg.match(/driver_id:([a-f0-9-]+)/i);
    if (match?.[1]) triedDriverIds.add(match[1]);
  }

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select(`
      id,
      first_name,
      last_name,
      phone,
      online,
      busy,
      lat,
      lng,
      verification_status,
      subscription_status,
      subscription_expires_at
    `);

  if (driversError) {
    return { ok: false as const, error: driversError.message };
  }

  const candidates = ((drivers || []) as DriverRow[])
    .filter(canTakeTrips)
    .filter((d) => !triedDriverIds.has(d.id))
    .map((driver) => ({
      ...driver,
      distance_km: distanceKm(
        Number(trip.pickup_lat),
        Number(trip.pickup_lng),
        Number(driver.lat),
        Number(driver.lng)
      ),
    }))
    .sort((a, b) => a.distance_km - b.distance_km);

  if (candidates.length === 0) {
    await supabase
      .from("trips")
      .update({
        status: "requested",
        driver_id: null,
        offer_status: null,
        offer_expires_at: null,
      })
      .eq("id", params.tripId);

    try {
      await supabase.from("trip_events").insert({
        trip_id: params.tripId,
        event_type: "offer_rollover_exhausted",
        message: "No more eligible drivers available for rollover",
        old_status: trip.status,
        new_status: "requested",
      });
    } catch {}

    return {
      ok: true as const,
      reassigned: false,
      message: "No more eligible drivers found. Trip returned to requested.",
    };
  }

  const driver = candidates[0];
  const expiresAt = new Date(Date.now() + 30 * 1000).toISOString();

  const { error: busyError } = await supabase
    .from("drivers")
    .update({ busy: true })
    .eq("id", driver.id)
    .eq("busy", false);

  if (busyError) {
    return { ok: false as const, error: busyError.message };
  }

  const { error: updateError } = await supabase
    .from("trips")
    .update({
      driver_id: driver.id,
      status: "offered",
      offer_status: "pending",
      offer_expires_at: expiresAt,
    })
    .eq("id", params.tripId);

  if (updateError) {
    await supabase.from("drivers").update({ busy: false }).eq("id", driver.id);
    return { ok: false as const, error: updateError.message };
  }

  try {
    await supabase.from("trip_events").insert({
      trip_id: params.tripId,
      event_type: "driver_offer_sent_rollover",
      message: `Offer rollover sent to next nearest driver driver_id:${driver.id}`,
      old_status: trip.status,
      new_status: "offered",
    });
  } catch {}

  const { data: driverAccount } = await supabase
    .from("driver_accounts")
    .select("user_id")
    .eq("driver_id", driver.id)
    .maybeSingle();

  if (driverAccount?.user_id) {
    try {
      await sendPushToTargets({
        userIds: [driverAccount.user_id],
        title: "New trip offer",
        body: `You have a trip offer from ${trip.pickup_address ?? "pickup"} to ${trip.dropoff_address ?? "destination"}.`,
        url: "/driver",
      });
    } catch {}
  }

  return {
    ok: true as const,
    reassigned: true,
    driverId: driver.id,
    driverName: `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim(),
    expiresAt,
  };
}