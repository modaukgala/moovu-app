import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

const ACTIVE_STATUSES = ["offered", "assigned", "arrived", "ongoing"];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin, user } = auth;
    const { driverId, action } = await req.json();

    const safeDriverId = String(driverId ?? "").trim();
    const safeAction = String(action ?? "").trim();

    if (!safeDriverId) {
      return NextResponse.json({ ok: false, error: "Missing driverId." }, { status: 400 });
    }

    if (!["clear_busy_flag", "clear_busy_and_trip"].includes(safeAction)) {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    const { data: activeTrip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,status,offer_status,pickup_address,dropoff_address")
      .eq("driver_id", safeDriverId)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tripError) {
      return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
    }

    const { error: clearBusyError } = await supabaseAdmin
      .from("drivers")
      .update({
        busy: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", safeDriverId);

    if (clearBusyError) {
      return NextResponse.json({ ok: false, error: clearBusyError.message }, { status: 500 });
    }

    if (safeAction === "clear_busy_flag") {
      return NextResponse.json({
        ok: true,
        message: activeTrip
          ? "Driver busy flag cleared. Active trip was left unchanged."
          : "Driver busy flag cleared.",
      });
    }

    if (!activeTrip) {
      return NextResponse.json({
        ok: true,
        message: "Driver busy flag cleared. No active trip was attached.",
      });
    }

    if (activeTrip.status === "ongoing") {
      return NextResponse.json({
        ok: false,
        error: "This driver has an ongoing trip. Complete or cancel that trip manually before detaching.",
      }, { status: 400 });
    }

    const nextStatus = activeTrip.status === "offered" ? "requested" : "cancelled";

    const { error: tripUpdateError } = await supabaseAdmin
      .from("trips")
      .update({
        driver_id: null,
        status: nextStatus,
        offer_status: activeTrip.status === "offered" ? "cleared_by_admin" : activeTrip.offer_status,
      })
      .eq("id", activeTrip.id);

    if (tripUpdateError) {
      return NextResponse.json({ ok: false, error: tripUpdateError.message }, { status: 500 });
    }

    try {
      await supabaseAdmin.from("trip_events").insert({
        trip_id: activeTrip.id,
        event_type: "admin_driver_clear",
        message: `Driver detached by admin (${safeAction})`,
        old_status: activeTrip.status,
        new_status: nextStatus,
        created_by: user.id,
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      message: `Driver busy cleared and trip ${activeTrip.id} was updated to ${nextStatus}.`,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error.") },
      { status: 500 }
    );
  }
}
