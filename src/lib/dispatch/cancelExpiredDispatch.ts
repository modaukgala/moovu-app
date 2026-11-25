import { supabaseAdmin } from "@/lib/supabase/admin";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";
import { callPhase4Rpc } from "@/lib/server/phase4Rpc";
import { isOutboxDeliveryEnabled } from "@/lib/notifications/outboxDelivery";

export async function cancelExpiredDispatch(tripId: string) {
  // Never auto-cancel a trip the customer already paid for online: the expiry
  // RPC does not refund. Leave it open for an admin to reassign or refund.
  const { data: tripRow } = await supabaseAdmin.from("trips").select("payment_method").eq("id", tripId).maybeSingle();
  if (String(tripRow?.payment_method ?? "cash").toLowerCase() === "online") {
    return { ok: false as const, changed: false, reason: "online_payment_needs_admin" };
  }
  const result = await callPhase4Rpc<{ changed: boolean; replayed: boolean }>(
    supabaseAdmin, "phase4b_expire_dispatch_trip", { p_trip_id: tripId },
    (value) => typeof value.changed === "boolean" || value.replayed === true,
  );
  if (!result.ok) throw new Error(result.error);
  if (!result.result.changed) {
    return { ok: false as const, changed: false, reason: "Trip is no longer awaiting a driver." };
  }
  // The terminal transition and outbox identity committed in one database transaction.
  if (!isOutboxDeliveryEnabled()) {
    await Promise.allSettled([
      notifyCustomerForTrip(tripId, "Sorry, no driver was available",
        "We searched for 30 minutes but no driver accepted. You were not charged. Please try again shortly.", `/ride/${tripId}`),
      notifyAdmins("Trip auto-cancelled", `Trip ${tripId} expired after 30 minutes.`, `/admin/trips/${tripId}`),
    ]);
  }
  return { ok: true as const, changed: true, reason: "No eligible driver accepted within 30 minutes." };
}
