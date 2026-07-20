import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { applyTripCommissionServer } from "@/lib/finance/applyTripCommissionServer";
import { notifyAdmins, notifyCustomerForTrip, notifyDriverForTrip } from "@/lib/push-notify";

const REASONS = new Set([
  "Driver forgot to complete trip",
  "Driver app issue",
  "Customer confirmed trip ended",
  "Support-assisted completion",
  "Other",
]);

export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const tripId = String(body?.tripId ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  const note = String(body?.note ?? "").trim();
  const finalFare = Number(body?.finalFare);

  if (!tripId || !REASONS.has(reason)) {
    return NextResponse.json({ ok: false, error: "Trip ID and a valid completion reason are required." }, { status: 400 });
  }
  if (reason === "Other" && !note) {
    return NextResponse.json({ ok: false, error: "Please provide details for Other." }, { status: 400 });
  }
  if (!Number.isFinite(finalFare) || finalFare <= 0) {
    return NextResponse.json({ ok: false, error: "A valid final fare is required." }, { status: 400 });
  }

  const { data: trip, error: tripError } = await auth.supabaseAdmin
    .from("trips")
    .select("id,status,driver_id,ride_option")
    .eq("id", tripId)
    .maybeSingle();
  if (tripError || !trip) {
    return NextResponse.json({ ok: false, error: tripError?.message ?? "Trip not found." }, { status: tripError ? 500 : 404 });
  }
  if (trip.status !== "ongoing") {
    return NextResponse.json({ ok: false, error: "Only ongoing trips can be completed by admin." }, { status: 409 });
  }
  if (!trip.driver_id) {
    return NextResponse.json({ ok: false, error: "The ongoing trip has no assigned driver." }, { status: 409 });
  }

  const completedAt = new Date().toISOString();
  const { data: completed, error: completionError } = await auth.supabaseAdmin
    .from("trips")
    .update({
      status: "completed",
      fare_amount: finalFare,
      final_fare: finalFare,
      fare_finalized_at: completedAt,
      completed_at: completedAt,
      completed_by: "admin",
      admin_completion_reason: reason,
      admin_completion_note: note || null,
    })
    .eq("id", tripId)
    .eq("status", "ongoing")
    .select("id")
    .maybeSingle();

  if (completionError || !completed) {
    return NextResponse.json({ ok: false, error: completionError?.message ?? "Trip state changed before completion." }, { status: completionError ? 500 : 409 });
  }

  const commission = await applyTripCommissionServer({
    tripId,
    driverId: trip.driver_id,
    fareAmount: finalFare,
    createdBy: auth.user.id,
    rideOptionId: trip.ride_option,
  });
  if (!commission.ok) {
    console.error("[admin-trip-complete] commission reconciliation failed", { tripId, error: commission.error });
    return NextResponse.json({ ok: false, error: `Trip completed, but financial reconciliation needs attention: ${commission.error}` }, { status: 500 });
  }

  await auth.supabaseAdmin.from("drivers").update({ busy: false }).eq("id", trip.driver_id);
  const { error: auditError } = await auth.supabaseAdmin.from("audit_logs").insert({
    actor_id: auth.user.id,
    action: "trip_completed",
    entity_type: "trip",
    entity_id: tripId,
    detail: {
      reason,
      note: note || null,
      previous_status: trip.status,
      final_status: "completed",
      final_fare: finalFare,
    },
  });
  if (auditError) console.error("[admin-trip-complete] audit insert failed", { tripId, error: auditError.message });

  await auth.supabaseAdmin.from("trip_events").insert({
    trip_id: tripId,
    event_type: "trip_completed_admin",
    message: `Admin override completion: ${reason}${note ? ` — ${note}` : ""}`,
    old_status: trip.status,
    new_status: "completed",
    created_by: auth.user.id,
  });

  await Promise.all([
    notifyCustomerForTrip(tripId, "Trip completed", "MOOVU support confirmed that your trip is complete.", `/ride/${tripId}`),
    notifyDriverForTrip(tripId, "Trip completed", "MOOVU support completed this trip after verification.", "/driver"),
    notifyAdmins("Trip completed by admin", `Trip ${tripId} was completed using an audited admin override.`, `/admin/trips/${tripId}`),
  ].map((promise) => promise.catch(() => null)));

  return NextResponse.json({ ok: true, commission });
}
