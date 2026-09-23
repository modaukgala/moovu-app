import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { notifyAdmins, notifyCustomerForTrip, notifyDriverForTrip } from "@/lib/push-notify";
import { callPhase4Rpc } from "@/lib/server/phase4Rpc";
import { isOutboxDeliveryEnabled } from "@/lib/notifications/outboxDelivery";

type Result = { trip_id: string; driver_id: string | null; replayed: boolean };

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => null);
    const tripId = String(body?.tripId ?? "").trim();
    const reason = String(body?.reason ?? "Cancelled by admin").trim();
    if (!tripId) return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    const result = await callPhase4Rpc<Result>(auth.supabaseAdmin, "phase4b_cancel_trip_operational", {
      p_trip_id: tripId, p_actor_id: auth.user.id, p_actor_kind: "admin", p_reason: reason,
    }, (value) => typeof value.replayed === "boolean");
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    if (!result.result.replayed && !isOutboxDeliveryEnabled()) await Promise.allSettled([
      notifyCustomerForTrip(tripId, "Trip cancelled", `MOOVU cancelled your trip. Reason: ${reason}`, `/ride/${tripId}`),
      notifyDriverForTrip(tripId, "Trip cancelled", `MOOVU cancelled trip ${tripId}.`, "/driver"),
      notifyAdmins("Trip cancelled by admin", `Trip ${tripId} was cancelled. Reason: ${reason}`, "/admin/trips"),
    ]);
    return NextResponse.json({ ok: true, replayed: result.result.replayed, message: "Trip cancelled successfully." });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error." }, { status: 500 });
  }
}
