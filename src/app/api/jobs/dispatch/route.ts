import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dispatchTrip } from "@/lib/dispatch/dispatchTrip";
import { isDispatchWorkerAuthorized } from "@/lib/dispatch/dispatchScheduler";
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
      if (job.job_type === "release_scheduled") {
        await releaseDueScheduledTrips();
      } else if (job.job_type === "expire") {
        await supabaseAdmin.rpc("expire_due_trip_offers", { p_trip_id: job.trip_id });
      } else {
        const dispatchResult = await dispatchTrip({
          tripId: job.trip_id,
          cycle: job.dispatch_cycle,
          sequenceNumber: job.sequence_number + (job.job_type === "escalate" ? 1 : 0),
          allowLegacyFallback: false,
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
      results.push({ id: job.id, ok: true });
    } catch (jobError: unknown) {
      const message = jobError instanceof Error ? jobError.message : "Dispatch job failed.";
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
