import { supabaseAdmin } from "@/lib/supabase/admin";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";
import { sendPushSafe } from "@/lib/push-server";
import { dispatchTrip } from "@/lib/dispatch/dispatchTrip";
import type { OfferAction } from "@/lib/dispatch/types";

type ResponseRow = {
  ok: boolean;
  trip_id: string;
  driver_id: string;
  status: string;
  dispatch_cycle: number;
  sequence_number: number;
  cancelled_driver_ids?: string[] | null;
  error_code?: string | null;
  error_message?: string | null;
};

export type OfferResponseResult = {
  ok: boolean;
  status: number;
  tripId: string;
  state?: string;
  atomicUnavailable?: boolean;
  error?: string;
};

function missingRpc(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "PGRST202" || message.includes("accept_trip_offer") || message.includes("decline_trip_offer");
}

async function notifyLosingDrivers(driverIds: string[], tripId: string) {
  if (driverIds.length === 0) return;
  const { data: accounts } = await supabaseAdmin
    .from("driver_accounts")
    .select("user_id,driver_id")
    .in("driver_id", driverIds);
  const userIds = Array.from(new Set((accounts ?? []).map((row) => row.user_id).filter(Boolean)));
  if (userIds.length === 0) return;
  await sendPushSafe({
    userIds,
    role: "driver",
    title: "Trip no longer available",
    body: "Another nearby driver accepted this trip.",
    url: "/driver",
    data: { tripId, nativeActionType: "trip_offer_stale" },
  });
}

export async function respondToOffer(params: {
  tripId: string;
  driverId: string;
  action: OfferAction;
  source: "driver_app" | "native_notification";
}): Promise<OfferResponseResult> {
  const rpcName = params.action === "accept" ? "accept_trip_offer" : "decline_trip_offer";
  const { data, error } = await supabaseAdmin.rpc(rpcName, {
    p_trip_id: params.tripId,
    p_driver_id: params.driverId,
    p_source: params.source,
  });

  if (error) {
    if (missingRpc(error)) {
      return { ok: false, status: 503, tripId: params.tripId, atomicUnavailable: true, error: "Atomic dispatch migration is not active." };
    }
    return { ok: false, status: 500, tripId: params.tripId, error: error.message };
  }

  const row = (Array.isArray(data) ? data[0] : data) as ResponseRow | null;
  if (!row?.ok) {
    const conflict = row?.error_code === "OFFER_CONFLICT" || row?.error_code === "DRIVER_CONFLICT";
    return {
      ok: false,
      status: conflict ? 409 : 400,
      tripId: params.tripId,
      state: row?.status,
      error: row?.error_message ?? "Offer is no longer available.",
    };
  }

  if (params.action === "accept") {
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("first_name,last_name,phone")
      .eq("id", params.driverId)
      .maybeSingle();
    const driverName = `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || driver?.phone || "A driver";

    await Promise.all([
      notifyCustomerForTrip(
        params.tripId,
        "Driver accepted your ride",
        `${driverName} is on the way to your pickup.`,
        `/ride/${params.tripId}`,
      ).catch(() => null),
      notifyAdmins("Driver accepted trip", `${driverName} accepted trip ${params.tripId}.`, "/admin/dispatch").catch(() => null),
      notifyLosingDrivers(row.cancelled_driver_ids ?? [], params.tripId).catch(() => null),
    ]);

    return { ok: true, status: 200, tripId: params.tripId, state: "assigned" };
  }

  await dispatchTrip({
    tripId: params.tripId,
    cycle: Number(row.dispatch_cycle ?? 1),
    sequenceNumber: Number(row.sequence_number ?? 1) + 1,
    allowLegacyFallback: false,
  }).catch(() => null);

  return { ok: true, status: 200, tripId: params.tripId, state: "declined" };
}

