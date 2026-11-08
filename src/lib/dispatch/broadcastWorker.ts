import { supabaseAdmin } from "@/lib/supabase/admin";
import { boundedMap } from "@/lib/dispatch/broadcastPolicy";
import { sendOfferDevice } from "@/lib/push-server";
import { cancelExpiredDispatch } from "@/lib/dispatch/cancelExpiredDispatch";
import type { OfferDeviceJob, DeviceDeliveryResult } from "@/lib/dispatch/deviceDelivery";

export async function processOfferDeviceJobs(
  send: (job: OfferDeviceJob) => Promise<DeviceDeliveryResult> = sendOfferDevice,
) {
  const { data, error } = await supabaseAdmin.rpc("claim_driver_offer_devices", { p_limit: 200 });
  if (error) throw new Error("Device job claim failed.");
  const jobs = (data ?? []) as OfferDeviceJob[];
  const outcomes = await boundedMap(jobs, 8, async job => {
    let result: DeviceDeliveryResult;
    try { result = await send(job); } catch {
      result = { state: "FAILED", code: "PROVIDER_RESULT_UNCERTAIN" };
    }
    const { data: acknowledged, error: finishError } = await supabaseAdmin.rpc("finish_driver_offer_device", {
      p_job: job.id, p_claim: job.lease_token, p_state: result.state, p_code: result.code ?? null,
      p_retry_seconds: result.retrySeconds ?? Math.min(120, 10 * 2 ** Math.max(0, job.attempts - 1)),
    });
    if (finishError) throw new Error("Device job acknowledgement failed.");
    return { state: result.state, acknowledged: acknowledged === true };
  });
  const summary = { claimed: jobs.length, providerAccepted: outcomes.filter(row => row.state === "ACCEPTED").length,
    retries: outcomes.filter(row => row.state === "PENDING").length,
    staleAcknowledgements: outcomes.filter(row => !row.acknowledged).length };
  console.info("[broadcast] device work settled", summary);
  return summary;
}

export async function processBroadcastRequests() {
  const { data, error } = await supabaseAdmin.rpc("claim_driver_broadcasts", { p_limit: 20 });
  if (error) throw new Error("Broadcast request claim failed.");
  const requests = (data ?? []) as Array<{ trip_id: string; lease_token: string; deadline_at: string }>;
  const results = await boundedMap(requests, 4, async request => {
    try {
      if (Date.parse(request.deadline_at) <= Date.now()) {
        await cancelExpiredDispatch(request.trip_id);
        return true;
      }
      const { data: result, error: broadcastError } = await supabaseAdmin.rpc("run_driver_broadcast", {
        p_trip: request.trip_id, p_worker_claim: request.lease_token,
      });
      if (broadcastError || result?.handled !== true) throw new Error("BROADCAST_TRANSACTION_FAILED");
      return true;
    } catch {
      const { error: failureError } = await supabaseAdmin.rpc("fail_driver_broadcast", {
        p_trip: request.trip_id, p_claim: request.lease_token, p_code: "BROADCAST_WORKER_RETRY",
      });
      if (failureError) throw new Error("Broadcast failure acknowledgement failed.");
      return false;
    }
  });
  return { claimed: requests.length, succeeded: results.filter(Boolean).length };
}
