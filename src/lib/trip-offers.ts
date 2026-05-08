import { createClient } from "@supabase/supabase-js";
import { scoreDriverForTrip } from "@/lib/dispatch/driverScoring";
import { rebuildDriverQualityMetrics } from "@/lib/quality/rebuildDriverQualityMetrics";
import { sendPushToTargets } from "@/lib/push-server";
import { expireDriverSubscriptions } from "@/lib/subscriptions/expireDriverSubscriptions";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export const OFFER_ACCEPT_DEADLINE_SECONDS = 15;
export const OFFER_ESCALATION_SECONDS = 6;

type EligibleDriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  online: boolean | null;
  busy: boolean | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
};

type DriverQualityRow = {
  avg_rating?: number | null;
  quality_score?: number | null;
  acceptance_rate?: number | null;
} | null;

type DriverOfferStatsRow = {
  offers_missed?: number | null;
} | null;

type ScoredDriverRow = EligibleDriverRow & {
  quality: DriverQualityRow;
  offerStats: DriverOfferStatsRow;
  dispatchScore: number;
  distanceKm: number;
};

async function incrementDriverOfferReceived(driverId: string) {
  try {
    const rpcResult = await supabaseAdmin.rpc("increment_driver_offer_received", {
      p_driver_id: driverId,
    });

    if (!rpcResult.error) return;
  } catch {}

  const { data: stats } = await supabaseAdmin
    .from("driver_offer_stats")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  const current = stats ?? {
    offers_received: 0,
    offers_accepted: 0,
    offers_rejected: 0,
    offers_missed: 0,
  };

  await supabaseAdmin.from("driver_offer_stats").upsert(
    {
      driver_id: driverId,
      offers_received: Number(current.offers_received || 0) + 1,
      offers_accepted: Number(current.offers_accepted || 0),
      offers_rejected: Number(current.offers_rejected || 0),
      offers_missed: Number(current.offers_missed || 0),
      last_offer_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "driver_id" }
  );
}

async function incrementDriverOfferMissed(driverId: string) {
  const { data: stats } = await supabaseAdmin
    .from("driver_offer_stats")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  const current = stats ?? {
    offers_received: 0,
    offers_accepted: 0,
    offers_rejected: 0,
    offers_missed: 0,
  };

  await supabaseAdmin.from("driver_offer_stats").upsert(
    {
      driver_id: driverId,
      offers_received: Number(current.offers_received || 0),
      offers_accepted: Number(current.offers_accepted || 0),
      offers_rejected: Number(current.offers_rejected || 0),
      offers_missed: Number(current.offers_missed || 0) + 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "driver_id" }
  );
}

function logOfferTableError(context: string, error: { message?: string } | null | undefined) {
  if (!error?.message) return;
  console.error(`[dispatch] ${context}`, { reason: error.message });
}

export async function expirePendingOfferIfNeeded(tripId: string) {
  const { data: trip, error } = await supabaseAdmin
    .from("trips")
    .select("id,status,driver_id,offer_status,offer_expires_at,offer_attempted_driver_ids")
    .eq("id", tripId)
    .maybeSingle();

  if (error || !trip) {
    return {
      ok: false,
      expired: false,
      error: error?.message || "Trip not found.",
    };
  }

  if (trip.status !== "offered" || trip.offer_status !== "pending") {
    return { ok: true, expired: false };
  }

  const expiresAtMs = trip.offer_expires_at
    ? new Date(trip.offer_expires_at).getTime()
    : null;

  if (!expiresAtMs || Date.now() <= expiresAtMs) {
    return { ok: true, expired: false };
  }

  const attemptedDriverIds = Array.from(
    new Set([
      ...(trip.offer_attempted_driver_ids ?? []),
      ...(trip.driver_id ? [trip.driver_id] : []),
    ])
  );

  if (trip.driver_id) {
    await supabaseAdmin.from("drivers").update({ busy: false }).eq("id", trip.driver_id);

    try {
      await incrementDriverOfferMissed(trip.driver_id);
    } catch {}

    const { error: offerUpdateError } = await supabaseAdmin
      .from("driver_trip_offers")
      .update({
        status: "expired",
        responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("trip_id", tripId)
      .eq("driver_id", trip.driver_id)
      .in("status", ["pending", "shown"]);

    logOfferTableError("failed to mark offer expired", offerUpdateError);
  }

  const { error: updateError } = await supabaseAdmin
    .from("trips")
    .update({
      driver_id: null,
      status: "requested",
      offer_status: "expired",
      offer_expires_at: null,
      offer_attempted_driver_ids: attemptedDriverIds,
    })
    .eq("id", tripId);

  if (updateError) {
    return { ok: false, expired: false, error: updateError.message };
  }

  try {
    await supabaseAdmin.from("trip_events").insert({
      trip_id: tripId,
      event_type: "offer_expired",
      message: "Offer expired automatically",
      old_status: "offered",
      new_status: "requested",
    });
  } catch {}

  return {
    ok: true,
    expired: true,
    expiredDriverId: trip.driver_id ?? null,
    attemptedDriverIds,
  };
}

export async function offerNextEligibleDriver(
  tripId: string,
  excludedDriverIds: string[] = []
) {
  await expireDriverSubscriptions().catch(() => {});

  const { data: trip, error: tripError } = await supabaseAdmin
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .maybeSingle();

  if (tripError || !trip) {
    return {
      ok: false,
      error: tripError?.message || "Trip not found.",
    };
  }

  if (
    trip.pickup_lat == null ||
    trip.pickup_lng == null ||
    trip.status === "completed" ||
    trip.status === "cancelled"
  ) {
    return {
      ok: false,
      error: "Trip is not eligible for offering.",
    };
  }

  const blockedDriverIds = new Set<string>([
    ...(excludedDriverIds ?? []),
    ...((trip.offer_attempted_driver_ids ?? []) as string[]),
  ]);

  const { data: drivers, error: driverError } = await supabaseAdmin
    .from("drivers")
    .select(`
      id,
      first_name,
      last_name,
      phone,
      lat,
      lng,
      online,
      busy,
      subscription_status,
      subscription_expires_at
    `)
    .eq("online", true)
    .eq("busy", false);

  if (driverError) {
    return {
      ok: false,
      error: driverError.message,
    };
  }

  const nowMs = Date.now();

  const filteredDrivers = ((drivers ?? []) as EligibleDriverRow[]).filter((driver) => {
    if (blockedDriverIds.has(driver.id)) return false;

    const expiryMs = driver.subscription_expires_at
      ? new Date(driver.subscription_expires_at).getTime()
      : null;

    const subscriptionValid =
      driver.subscription_status === "active" &&
      expiryMs != null &&
      expiryMs > nowMs;

    return subscriptionValid;
  });

  if (filteredDrivers.length === 0) {
    return {
      ok: false,
      error: "No eligible drivers available.",
    };
  }

  const enriched: ScoredDriverRow[] = [];

  for (const driver of filteredDrivers) {
    try {
      await rebuildDriverQualityMetrics(driver.id);
    } catch {}

    const { data: quality } = await supabaseAdmin
      .from("driver_quality_metrics")
      .select("avg_rating,quality_score,acceptance_rate")
      .eq("driver_id", driver.id)
      .maybeSingle();

    const { data: offerStats } = await supabaseAdmin
      .from("driver_offer_stats")
      .select("offers_missed")
      .eq("driver_id", driver.id)
      .maybeSingle();

    const scored = scoreDriverForTrip({
      pickupLat: Number(trip.pickup_lat),
      pickupLng: Number(trip.pickup_lng),
      driver: {
        ...driver,
        quality: quality ?? null,
        offerStats: offerStats ?? null,
      },
    });

    enriched.push({
      ...driver,
      quality: quality ?? null,
      offerStats: offerStats ?? null,
      dispatchScore: scored.score,
      distanceKm: scored.distanceKm,
    });
  }

  enriched.sort((a, b) => b.dispatchScore - a.dispatchScore);

  const chosen = enriched[0];

  if (!chosen || chosen.dispatchScore < -1000) {
    return {
      ok: false,
      error: "No suitable driver was found.",
    };
  }

  const expiresAt = new Date(Date.now() + OFFER_ACCEPT_DEADLINE_SECONDS * 1000).toISOString();
  const escalatesAt = new Date(Date.now() + OFFER_ESCALATION_SECONDS * 1000).toISOString();

  const { error: markBusyError } = await supabaseAdmin
    .from("drivers")
    .update({ busy: true })
    .eq("id", chosen.id)
    .eq("busy", false);

  if (markBusyError) {
    return {
      ok: false,
      error: markBusyError.message,
    };
  }

  const { error: updateTripError } = await supabaseAdmin
    .from("trips")
    .update({
      status: "offered",
      offer_status: "pending",
      offer_expires_at: expiresAt,
      driver_id: chosen.id,
      dispatch_priority_score: chosen.dispatchScore,
    })
    .eq("id", trip.id);

  if (updateTripError) {
    await supabaseAdmin.from("drivers").update({ busy: false }).eq("id", chosen.id);

    return {
      ok: false,
      error: updateTripError.message,
    };
  }

  await incrementDriverOfferReceived(chosen.id);

  const { error: offerInsertError } = await supabaseAdmin.from("driver_trip_offers").insert(
    {
      trip_id: trip.id,
      driver_id: chosen.id,
      status: "shown",
      offered_at: new Date().toISOString(),
      visible_until: escalatesAt,
      escalates_at: escalatesAt,
      accept_deadline_at: expiresAt,
      distance_km: chosen.distanceKm,
      dispatch_score: chosen.dispatchScore,
      updated_at: new Date().toISOString(),
    }
  );

  logOfferTableError("failed to create driver_trip_offers row", offerInsertError);

  try {
    await supabaseAdmin.from("trip_events").insert({
      trip_id: trip.id,
      event_type: "offer_sent",
      message: `Offered to driver ${chosen.id} (accept deadline ${OFFER_ACCEPT_DEADLINE_SECONDS}s, escalation target ${OFFER_ESCALATION_SECONDS}s, about ${chosen.distanceKm} km away, score ${chosen.dispatchScore})`,
      old_status: trip.status,
      new_status: "offered",
    });
  } catch {}

  const { data: driverAccount } = await supabaseAdmin
    .from("driver_accounts")
    .select("user_id")
    .eq("driver_id", chosen.id)
    .maybeSingle();

  if (driverAccount?.user_id) {
    try {
      await sendPushToTargets({
        userIds: [driverAccount.user_id],
        role: "driver",
        title: "New trip offer",
        body: `Pickup at ${trip.pickup_address ?? "pickup"} - Destination ${trip.dropoff_address ?? "destination"}`,
        url: "/driver",
      });
    } catch {}
  }

  return {
    ok: true,
    driverId: chosen.id,
    expiresAt,
    distanceKm: chosen.distanceKm,
    dispatchScore: chosen.dispatchScore,
  };
}
