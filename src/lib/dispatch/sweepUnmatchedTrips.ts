import { supabaseAdmin } from "@/lib/supabase/admin";
import { notifyAdmins } from "@/lib/push-notify";
import { cancelExpiredDispatch } from "@/lib/dispatch/cancelExpiredDispatch";

const EXPIRY_MS = 30 * 60 * 1000;

/**
 * Safety net run every minute by the dispatch cron: ends trips that have had no
 * driver for 30 minutes even if their scheduled expiry job was never queued.
 * Cash trips are closed with a customer notice. Online-paid trips are never
 * auto-cancelled (no automatic refund); admins are alerted once instead.
 */
export async function sweepUnmatchedTrips(now = Date.now()) {
  const cutoff = new Date(now - EXPIRY_MS).toISOString();
  const { data, error } = await supabaseAdmin.from("trips")
    .select("id,payment_method,created_at,dispatch_started_at,scheduled_for")
    .in("status", ["requested", "offered"]).is("driver_id", null)
    .lt("created_at", cutoff).limit(25);
  if (error) return { ok: false as const, error: error.message };

  const results: Array<{ tripId: string; outcome: string }> = [];
  for (const trip of data ?? []) {
    const startedMs = Date.parse(trip.dispatch_started_at ?? trip.scheduled_for ?? trip.created_at);
    if (Number.isFinite(startedMs) && now - startedMs < EXPIRY_MS) continue; // scheduled trip released recently
    if (String(trip.payment_method ?? "cash").toLowerCase() === "online") {
      const { data: flagged } = await supabaseAdmin.from("trip_events").select("id")
        .eq("trip_id", trip.id).eq("event_type", "dispatch_needs_admin").limit(1);
      if (!flagged?.length) {
        await supabaseAdmin.from("trip_events").insert({
          trip_id: trip.id, event_type: "dispatch_needs_admin",
          message: "Paid online trip has had no driver for 30 minutes. Reassign or refund.",
        });
        await notifyAdmins("Paid trip needs attention",
          "An online-paid trip has had no driver for 30 minutes. Reassign or refund it.", `/admin/trips/${trip.id}`)
          .catch(() => undefined);
      }
      results.push({ tripId: trip.id, outcome: "online_flagged" });
      continue;
    }
    try {
      const r = await cancelExpiredDispatch(trip.id);
      results.push({ tripId: trip.id, outcome: r.changed ? "cancelled" : r.reason });
    } catch (e) {
      results.push({ tripId: trip.id, outcome: e instanceof Error ? e.message : "error" });
    }
  }
  return { ok: true as const, results };
}
