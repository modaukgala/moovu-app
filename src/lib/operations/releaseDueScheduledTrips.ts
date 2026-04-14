import { createClient } from "@supabase/supabase-js";
import { offerNextEligibleDriver } from "@/lib/trip-offers";
import { sendPushToTargets } from "@/lib/push-server";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function releaseDueScheduledTrips() {
  const releaseBeforeMinutes = 15;
  const now = new Date();
  const releaseCutoff = new Date(now.getTime() + releaseBeforeMinutes * 60 * 1000);

  const { data: dueTrips, error } = await supabaseAdmin
    .from("trips")
    .select("id,pickup_address,dropoff_address,scheduled_for,status,ride_type,schedule_status")
    .eq("ride_type", "scheduled")
    .eq("status", "scheduled")
    .eq("schedule_status", "scheduled")
    .lte("scheduled_for", releaseCutoff.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(error.message);
  }

  if (!dueTrips || dueTrips.length === 0) {
    return {
      ok: true,
      released: 0,
      tripIds: [] as string[],
    };
  }

  const releasedTripIds: string[] = [];

  for (const trip of dueTrips) {
    const { error: updateError } = await supabaseAdmin
      .from("trips")
      .update({
        status: "requested",
        schedule_status: "released",
        released_at: new Date().toISOString(),
      })
      .eq("id", trip.id)
      .eq("status", "scheduled");

    if (updateError) {
      continue;
    }

    releasedTripIds.push(trip.id);

    try {
      await supabaseAdmin.from("trip_events").insert({
        trip_id: trip.id,
        event_type: "scheduled_trip_released",
        message: `Scheduled trip automatically released for dispatch.`,
        old_status: "scheduled",
        new_status: "requested",
      });
    } catch {}

    try {
      await sendPushToTargets({
        role: "admin",
        title: "Scheduled ride released",
        body: `A scheduled ride from ${trip.pickup_address ?? "pickup"} to ${trip.dropoff_address ?? "destination"} is now being dispatched.`,
        url: "/admin/trips",
      });
    } catch {}

    try {
      await offerNextEligibleDriver(trip.id, []);
    } catch {}
  }

  return {
    ok: true,
    released: releasedTripIds.length,
    tripIds: releasedTripIds,
  };
}