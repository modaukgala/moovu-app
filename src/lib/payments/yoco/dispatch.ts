import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { dispatchTrip } from "@/lib/dispatch/dispatchTrip";
import { shouldDispatchPaidTrip } from "@/lib/payments/onlinePayment";

export async function dispatchVerifiedOnlineTrip(paymentAttemptId: string) {
  const { data: attempt } = await supabaseAdmin
    .from("online_payment_attempts")
    .select("id,trip_id,state,dispatch_attempts")
    .eq("id", paymentAttemptId)
    .maybeSingle();
  if (!attempt || attempt.state !== "SUCCEEDED") return { ok: false, deferred: false, reason: "PAYMENT_NOT_SUCCEEDED" };

  const { data: trip } = await supabaseAdmin
    .from("trips")
    .select("id,status,driver_id,ride_type")
    .eq("id", attempt.trip_id)
    .maybeSingle();
  if (!trip) return { ok: false, deferred: false, reason: "TRIP_NOT_FOUND" };
  if (trip.ride_type !== "now") {
    await supabaseAdmin.from("online_payment_attempts").update({ dispatch_state: "DEFERRED", dispatch_last_error: null })
      .eq("id", paymentAttemptId).neq("dispatch_state", "DISPATCHED");
    return { ok: true, deferred: true, reason: "SCHEDULED_TRIP" };
  }
  if (!shouldDispatchPaidTrip({ ...trip, driverId: trip.driver_id, rideType: trip.ride_type, paymentState: attempt.state })) {
    await supabaseAdmin.from("online_payment_attempts").update({ dispatch_state: "DISPATCHED", dispatch_last_error: null, dispatched_at: new Date().toISOString() })
      .eq("id", paymentAttemptId);
    return { ok: true, deferred: false, reason: "ALREADY_HANDLED_OR_NOT_DISPATCHABLE" };
  }

  const result = await dispatchTrip({ tripId: trip.id });
  if (!result.ok) {
    await supabaseAdmin.from("online_payment_attempts").update({
      dispatch_state: "FAILED", dispatch_last_error: String(result.error ?? "Paid trip dispatch failed.").slice(0, 500),
      dispatch_attempts: Number(attempt.dispatch_attempts ?? 0) + 1,
    }).eq("id", paymentAttemptId);
    throw new Error(result.error ?? "Paid trip dispatch failed.");
  }
  await supabaseAdmin.from("online_payment_attempts").update({
    dispatch_state: "DISPATCHED", dispatch_last_error: null, dispatched_at: new Date().toISOString(),
    dispatch_attempts: Number(attempt.dispatch_attempts ?? 0) + 1,
  }).eq("id", paymentAttemptId);
  return { ok: true, deferred: false, reason: "DISPATCHED" };
}
