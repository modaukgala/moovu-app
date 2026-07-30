import { supabaseAdmin } from "@/lib/supabase/admin";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";
import { sendPushSafe } from "@/lib/push-server";

const AUTO_CANCEL_REASON = "No eligible driver accepted within 3 minutes.";

function isMissingAutoCancelColumn(error: { message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    message.includes("auto_cancelled_at") ||
    message.includes("cancellation_reason") ||
    message.includes("cancellation_reason_details")
  );
}

export async function cancelExpiredDispatch(tripId: string) {
  const now = new Date().toISOString();
  const { data: activeOffers } = await supabaseAdmin
    .from("driver_trip_offers")
    .select("driver_id")
    .eq("trip_id", tripId)
    .in("status", ["pending", "shown"]);

  let updateResult = await supabaseAdmin
    .from("trips")
    .update({
      status: "cancelled",
      cancel_reason: AUTO_CANCEL_REASON,
      cancellation_reason: AUTO_CANCEL_REASON,
      cancellation_reason_details: "Automatic dispatch timeout",
      cancelled_by: "system",
      cancelled_at: now,
      auto_cancelled_at: now,
      offer_status: "cancelled",
    })
    .eq("id", tripId)
    .in("status", ["requested", "offered"])
    .is("driver_id", null)
    .select("id")
    .maybeSingle();

  if (updateResult.error && isMissingAutoCancelColumn(updateResult.error)) {
    updateResult = await supabaseAdmin
      .from("trips")
      .update({
        status: "cancelled",
        cancel_reason: AUTO_CANCEL_REASON,
        cancelled_by: "system",
        cancelled_at: now,
        offer_status: "cancelled",
      })
      .eq("id", tripId)
      .in("status", ["requested", "offered"])
      .is("driver_id", null)
      .select("id")
      .maybeSingle();
  }

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }
  if (!updateResult.data?.id) {
    return { ok: false as const, changed: false, reason: "Trip is no longer awaiting a driver." };
  }

  await Promise.all([
    supabaseAdmin
      .from("driver_trip_offers")
      .update({
        status: "cancelled",
        cancelled_at: now,
        responded_at: now,
        updated_at: now,
      })
      .eq("trip_id", tripId)
      .in("status", ["pending", "shown"]),
    supabaseAdmin
      .from("dispatch_jobs")
      .update({
        status: "cancelled",
        completed_at: now,
        updated_at: now,
      })
      .eq("trip_id", tripId)
      .in("status", ["pending", "processing"]),
    supabaseAdmin.from("trip_events").insert({
      trip_id: tripId,
      event_type: "dispatch_auto_cancelled",
      message: AUTO_CANCEL_REASON,
      old_status: "offered",
      new_status: "cancelled",
    }),
  ]);

  const driverIds = Array.from(
    new Set((activeOffers ?? []).map((offer) => String(offer.driver_id ?? "")).filter(Boolean)),
  );
  if (driverIds.length > 0) {
    const { data: accounts } = await supabaseAdmin
      .from("driver_accounts")
      .select("user_id")
      .in("driver_id", driverIds);
    const userIds = Array.from(
      new Set((accounts ?? []).map((account) => String(account.user_id ?? "")).filter(Boolean)),
    );
    if (userIds.length > 0) {
      await sendPushSafe({
        userIds,
        role: "driver",
        title: "Trip request closed",
        body: "This trip is no longer available.",
        url: "/driver",
        data: { type: "trip_cancelled", tripId },
      }).catch(() => null);
    }
  }

  await Promise.all([
    notifyCustomerForTrip(
      tripId,
      "No driver accepted your trip",
      "No driver was available for this request. Please try again.",
      `/ride/${tripId}`,
      { type: "trip_cancelled", tripId },
    ).catch(() => null),
    notifyAdmins(
      "Trip auto-cancelled",
      `Trip ${tripId} was cancelled because no eligible driver accepted within three minutes.`,
      `/admin/trips/${tripId}`,
    ).catch(() => null),
  ]);

  return { ok: true as const, changed: true, reason: AUTO_CANCEL_REASON };
}
