import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";
import { callPhase4Rpc } from "@/lib/server/phase4Rpc";
import { isOutboxDeliveryEnabled } from "@/lib/notifications/outboxDelivery";

const VALID_REASONS = ["Customer asked to cancel", "Could not reach pickup", "Unsafe pickup situation", "Vehicle issue", "Emergency", "Other"];
type Result = { trip_id: string; replayed: boolean };

export async function POST(req: Request) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 401 });
    const body = await req.json().catch(() => null);
    const tripId = String(body?.tripId ?? "").trim();
    const reason = String(body?.reason ?? "").trim();
    if (!tripId) return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    if (!VALID_REASONS.includes(reason)) return NextResponse.json({ ok: false, error: "Please select a valid cancellation reason." }, { status: 400 });
    const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const result = await callPhase4Rpc<Result>(admin, "phase4b_cancel_trip_operational", {
      p_trip_id: tripId, p_actor_id: user.id, p_actor_kind: "driver", p_reason: reason,
    }, (value) => typeof value.replayed === "boolean");
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    if (!result.result.replayed && !isOutboxDeliveryEnabled()) await Promise.allSettled([
      notifyCustomerForTrip(tripId, "Trip cancelled", `Your driver cancelled the trip. Reason: ${reason}`, `/ride/${tripId}`),
      notifyAdmins("Trip cancelled by driver", `Trip ${tripId} was cancelled by the driver. Reason: ${reason}`, "/admin/trips"),
    ]);
    return NextResponse.json({ ok: true, replayed: result.result.replayed, message: "Trip cancelled successfully." });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error." }, { status: 500 });
  }
}
