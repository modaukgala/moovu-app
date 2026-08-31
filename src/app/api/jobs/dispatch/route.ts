import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dispatchTrip } from "@/lib/dispatch/dispatchTrip";
import { isDispatchExpired } from "@/lib/dispatch/config";
import { cancelExpiredDispatch } from "@/lib/dispatch/cancelExpiredDispatch";
import { isDispatchWorkerAuthorized } from "@/lib/dispatch/dispatchScheduler";
import { releaseDueScheduledTrips } from "@/lib/operations/releaseDueScheduledTrips";
import { MAX_DISPATCH_ATTEMPTS, retryDelayMs } from "@/lib/dispatch/reliability";

type ClaimedJob = {
  id: string;
  trip_id: string;
  offer_id: string | null;
  job_type: "escalate" | "expire" | "recover" | "release_scheduled";
  dispatch_cycle: number;
  sequence_number: number;
  attempts: number;
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
    const jobStarted = Date.now();
    try {
      if (!Number.isInteger(job.attempts) || job.attempts < 1 || job.attempts > MAX_DISPATCH_ATTEMPTS) {
        throw new Error("Dispatch attempt limit reached or claim contract invalid.");
      }
      console.log("[dispatch-worker] processing job", {
        operation: "dispatch-job", correlationId: `${job.id}:${job.attempts}`,
        id: job.id,
        tripId: job.trip_id,
        offerId: job.offer_id,
        jobType: job.job_type,
        cycle: job.dispatch_cycle,
        sequenceNumber: job.sequence_number,
        attempt: job.attempts,
        maxAttempts: MAX_DISPATCH_ATTEMPTS,
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
          .select("id,status,driver_id,dispatch_cycle,created_at")
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
            console.log("[dispatch-worker] no active offers remain, starting next round", {
              tripId: job.trip_id,
              nextCycle,
            });
            if (isDispatchExpired(trip.created_at)) {
              await cancelExpiredDispatch(job.trip_id);
            } else {
              const nextRound = await dispatchTrip({
                tripId: job.trip_id,
                cycle: nextCycle,
                sequenceNumber: 1,
              });
              if (!nextRound.ok && !nextRound.exhausted) {
                throw new Error(nextRound.error ?? "Next dispatch round failed.");
              }
            }
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

      const { data: completed, error: completionError } = await supabaseAdmin.from("dispatch_jobs").update({
        status: "completed",
        locked_at: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("status", "processing").eq("attempts", job.attempts).select("id");
      if (completionError) throw new Error("Could not acknowledge dispatch job completion.");
      console.log("[dispatch-worker] job settled", {
        id: job.id, tripId: job.trip_id, jobType: job.job_type,
        completed: Boolean(completed?.length), superseded: !completed?.length,
        durationMs: Date.now() - jobStarted, attempt: job.attempts,
      });
      results.push({ id: job.id, ok: true });
    } catch (jobError: unknown) {
      const message = jobError instanceof Error ? jobError.message : "Dispatch job failed.";
      const delayMs = retryDelayMs(job.attempts);
      console.error("[dispatch-worker] job failed", {
        id: job.id,
        tripId: job.trip_id,
        jobType: job.job_type,
        reason: message,
        attempt: job.attempts,
        retryDelayMs: delayMs,
        terminal: delayMs === null,
        maxAttempts: MAX_DISPATCH_ATTEMPTS,
        durationMs: Date.now() - jobStarted,
      });
      const { error: retryError } = await supabaseAdmin.from("dispatch_jobs").update({
        status: delayMs === null ? "failed" : "pending",
        locked_at: null,
        last_error: message,
        ...(delayMs === null ? {} : { run_at: new Date(Date.now() + delayMs).toISOString() }),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("status", "processing").eq("attempts", job.attempts);
      if (retryError) console.error("[dispatch-worker] retry acknowledgement failed", { id: job.id, code: retryError.code });
      results.push({ id: job.id, ok: false, error: message });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
