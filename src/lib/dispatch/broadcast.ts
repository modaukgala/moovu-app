import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processOfferDeviceJobs } from "@/lib/dispatch/broadcastWorker";
import { cancelExpiredDispatch } from "@/lib/dispatch/cancelExpiredDispatch";
import type { DispatchResult } from "@/lib/dispatch/types";

export type BroadcastOutcome = {
  handled: boolean; terminal?: boolean; deferred?: boolean; replayed?: boolean;
  deadline?: boolean; offer_count?: number; expected_count?: number; expires_at?: string; round_id?: string;
};

export async function dispatchBroadcastIfSelected(params: {
  tripId: string; paymentDispatch?: { attemptId: string; claimToken: string };
  preferredDriverId?: string | null; allowAfterAutomaticExhaustion?: boolean;
}): Promise<DispatchResult | null> {
  const { data: selected, error: selectionError } = await supabaseAdmin.from("driver_broadcast_requests")
    .select("trip_id").eq("trip_id", params.tripId).maybeSingle();
  if (selectionError) {
    // A pre-migration database retains its old dispatch implementation.
    if (["42P01", "PGRST205"].includes(String(selectionError.code))) return null;
    return { ok: false, tripId: params.tripId, error: "Dispatch policy lookup unavailable." };
  }
  if (!selected) return null;
  const { data, error } = await supabaseAdmin.rpc("run_driver_broadcast", {
    p_trip: params.tripId,
    p_payment_attempt: params.paymentDispatch?.attemptId ?? null,
    p_payment_claim: params.paymentDispatch?.claimToken ?? null,
    p_admin_restart: params.allowAfterAutomaticExhaustion === true,
    p_manual_driver: params.allowAfterAutomaticExhaustion ? params.preferredDriverId ?? null : null,
  });
  if (error) {
    console.error("[broadcast] transaction rejected", { tripId: params.tripId, code: error.code });
    return { ok: false, tripId: params.tripId, error: "Broadcast remains queued for recovery." };
  }
  const result = data as BroadcastOutcome;
  if (result.deadline) await cancelExpiredDispatch(params.tripId);
  if (result.expected_count != null && result.expected_count !== result.offer_count) {
    return { ok: false, tripId: params.tripId, error: "Broadcast recipient reconciliation failed." };
  }
  // The HTTP response must not wait behind a slow device. Jobs are already durable.
  try { after(async () => { await processOfferDeviceJobs(); }); } catch {
    console.info("[broadcast] background kick deferred to durable worker", { tripId: params.tripId });
  }
  if (params.preferredDriverId) {
    const { data: active, error: activeError } = await supabaseAdmin.from("driver_trip_offers")
      .select("id,accept_deadline_at").eq("trip_id", params.tripId).eq("driver_id", params.preferredDriverId)
      .in("status", ["pending", "shown"]).gt("accept_deadline_at", new Date().toISOString()).limit(1).maybeSingle();
    if (activeError || !active) return { ok: false, tripId: params.tripId,
      error: "No active offer for this Driver. Check eligibility or wait for the current broadcast round to end." };
    return { ok: true, tripId: params.tripId, driverId: params.preferredDriverId,
      offerId: active.id, offerCount: 1, expiresAt: active.accept_deadline_at, mode: "atomic", schedulerQueued: true };
  }
  return {
    ok: !result.deadline && !result.terminal,
    tripId: params.tripId, offerCount: result.offer_count ?? 0,
    expiresAt: result.expires_at, mode: "atomic", schedulerQueued: true,
    exhausted: result.deadline || result.terminal,
  };
}
