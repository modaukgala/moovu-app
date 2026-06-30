import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dispatchTrip } from "@/lib/dispatch/dispatchTrip";
import { DISPATCH_CONFIG, } from "@/lib/dispatch/config";
import { isDispatchWorkerAuthorized } from "@/lib/dispatch/dispatchScheduler";
import { enqueueDispatchJob } from "@/lib/dispatch/dispatchScheduler";
import { releaseDueScheduledTrips } from "@/lib/operations/releaseDueScheduledTrips";

type ClaimedJob = {
  id: string;
  trip_id: string;
  offer_id: string | null;
  job_type: "escalate" | "expire" | "recover" | "release_scheduled";
  dispatch_cycle: number;
  sequence_number: number;
};

export async function POST(req: Request) {
  if (!isDispatchWorkerAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized dispatch worker." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { limit?: number };
  const limit = Math.min(50, Math.max(1, Number(body.limit ?? 20)));
  const { data, error } = await supabaseAdmin.rpc("claim_due_dispatch_jobs", { p_limit: limit });
  if (error) {
    return NextResponse.json({ ok: false, error: "Dispatch worker schema is not active." }, { status: 503 });
  }

  const jobs = (data ?? []) as ClaimedJob[];
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const job of jobs) {
    try {
      console.log("[dispatch-worker] processing job", {
        id: job.id,
        tripId: job.trip_id,
        offerId: job.offer_id,
        jobType: job.job_type,
        cycle: job.dispatch_cycle,
        sequenceNumber: job.sequence_number,
      });
      if (job.job_type === "release_scheduled") {
        await releaseDueScheduledTrips();
      } else if (job.job_type === "expire") {
        const { data: expiredRows, error: expireError } = await supabaseAdmin.rpc("expire_due_trip_offers", { p_trip_id: job.trip_id });
        if (expireError) {
          throw new Error(expireError.message);
        }

        const expired = Array.isArray(expiredRows) ? expiredRows : [];
        if (expired.length > 0) {
          try {
            await supabaseAdmin.from("trip_events").insert(
              expired.map((row) => ({
                trip_id: row.trip_id,
                event_type: "offer_timed_out",
                message: `Offer timed out for driver ${row.driver_id}.`,
                old_status: "offered",
                new_status: "offered",
              })),
            );
          } catch {}
        }

        const { data: trip, error: tripError } = await supabaseAdmin
          .from("trips")
          .select("id,status,driver_id,dispatch_cycle")
          .eq("id", job.trip_id)
          .maybeSingle();

        if (tripError) {
          throw new Error(tripError.message);
        }

        if (trip && ["requested", "offered"].includes(String(trip.status)) && !trip.driver_id) {
          const nowIso = new Date().toISOString();
          const { data: activeOffers, error: activeOffersError } = await supabaseAdmin
            .from("driver_trip_offers")
            .select("id")
            .eq("trip_id", job.trip_id)
            .in("status", ["pending", "shown"])
            .gt("accept_deadline_at", nowIso)
            .limit(1);

          if (activeOffersError) {
            throw new Error(activeOffersError.message);
          }

          if ((activeOffers ?? []).length === 0) {
            const nextCycle = Math.max(1, Number(trip.dispatch_cycle ?? job.dispatch_cycle)) + 1;
            console.log("[dispatch-worker] no active offers remain, scheduling recover", {
              tripId: job.trip_id,
              nextCycle,
            });
            await enqueueDispatchJob({
              supabase: supabaseAdmin,
              tripId: job.trip_id,
              jobType: "recover",
              runAt: new Date(Date.now() + DISPATCH_CONFIG.cycleCooldownSeconds * 1000).toISOString(),
              dispatchCycle: nextCycle,
              sequenceNumber: 1,
            });
          }
        }
      } else {
        const dispatchResult = await dispatchTrip({
          tripId: job.trip_id,
          cycle: job.dispatch_cycle,
          sequenceNumber: job.sequence_number + (job.job_type === "escalate" ? 1 : 0),
        });
        if (!dispatchResult.ok && !dispatchResult.exhausted) {
          throw new Error(dispatchResult.error ?? "Dispatch step failed.");
        }
      }

      await supabaseAdmin.from("dispatch_jobs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      console.log("[dispatch-worker] completed job", { id: job.id, tripId: job.trip_id, jobType: job.job_type });
      results.push({ id: job.id, ok: true });
    } catch (jobError: unknown) {
      const message = jobError instanceof Error ? jobError.message : "Dispatch job failed.";
      console.error("[dispatch-worker] job failed", {
        id: job.id,
        tripId: job.trip_id,
        jobType: job.job_type,
        reason: message,
      });
      await supabaseAdmin.from("dispatch_jobs").update({
        status: "pending",
        last_error: message,
        run_at: new Date(Date.now() + 10_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      results.push({ id: job.id, ok: false, error: message });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
