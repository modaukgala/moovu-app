import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushSafe } from "@/lib/push-server";

export async function notifyDriverOffer(params: {
  tripId: string;
  driverId: string;
  pickup: string | null;
  destination: string | null;
}) {
  const { data: account } = await supabaseAdmin
    .from("driver_accounts")
    .select("user_id")
    .eq("driver_id", params.driverId)
    .maybeSingle();

  if (!account?.user_id) {
    console.error("[dispatch] driver offer notification target missing", {
      tripId: params.tripId,
      driverId: params.driverId,
    });
    throw new Error("Driver offer notification target missing.");
  }
  const result = await sendPushSafe({
    userIds: [account.user_id],
    role: "driver",
    title: "New trip nearby",
    body: `Pickup at ${params.pickup ?? "pickup"} to ${params.destination ?? "destination"}.`,
    url: `/driver?offerTripId=${params.tripId}`,
    data: {
      nativeActionType: "trip_offer",
      tripId: params.tripId,
      driverId: params.driverId,
    },
  });
  console.info("[dispatch] driver offer notification result", {
    tripId: params.tripId,
    driverId: params.driverId,
    delivered: result.delivered,
    failed: result.failed,
    removed: result.removed,
    ok: result.ok,
  });
  if (!result.ok) throw new Error("Driver offer notification delivery failed.");
}
