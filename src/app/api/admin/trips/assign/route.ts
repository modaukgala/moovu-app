import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { sendPushToTargets } from "@/lib/push-server";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { user, supabaseAdmin } = auth;
    const body = await req.json();

    const tripId = String(body?.tripId ?? "").trim();
    const driverId = String(body?.driverId ?? "").trim();

    if (!tripId || !driverId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID and Driver ID are required." },
        { status: 400 }
      );
    }

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,status,driver_id,pickup_address,dropoff_address,offer_attempted_driver_ids")
      .eq("id", tripId)
      .maybeSingle();

    if (tripError) {
      return NextResponse.json(
        { ok: false, error: tripError.message },
        { status: 500 }
      );
    }

    if (!trip) {
      return NextResponse.json(
        { ok: false, error: "Trip not found." },
        { status: 404 }
      );
    }

    if (["completed", "cancelled"].includes(String(trip.status))) {
      return NextResponse.json(
        { ok: false, error: `Trips in status "${trip.status}" cannot be assigned.` },
        { status: 400 }
      );
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id,first_name,last_name,phone,status,online,busy")
      .eq("id", driverId)
      .maybeSingle();

    if (driverError) {
      return NextResponse.json(
        { ok: false, error: driverError.message },
        { status: 500 }
      );
    }

    if (!driver) {
      return NextResponse.json(
        { ok: false, error: "Driver not found." },
        { status: 404 }
      );
    }

    if (!["approved", "active"].includes(String(driver.status ?? ""))) {
      return NextResponse.json(
        { ok: false, error: "Driver is not approved/active." },
        { status: 400 }
      );
    }

    if (driver.busy) {
      return NextResponse.json(
        { ok: false, error: "Driver is already busy." },
        { status: 400 }
      );
    }

    const expiresAt = new Date(Date.now() + 30 * 1000).toISOString();

    const { error: busyError } = await supabaseAdmin
      .from("drivers")
      .update({ busy: true })
      .eq("id", driverId)
      .eq("busy", false);

    if (busyError) {
      return NextResponse.json(
        { ok: false, error: busyError.message },
        { status: 500 }
      );
    }

    const attemptedDriverIds = Array.from(
      new Set([...(trip.offer_attempted_driver_ids ?? []), driverId])
    );

    const { error: updateTripError } = await supabaseAdmin
      .from("trips")
      .update({
        driver_id: driverId,
        status: "offered",
        offer_status: "pending",
        offer_expires_at: expiresAt,
        offer_attempted_driver_ids: attemptedDriverIds,
      })
      .eq("id", tripId);

    if (updateTripError) {
      await supabaseAdmin.from("drivers").update({ busy: false }).eq("id", driverId);

      return NextResponse.json(
        { ok: false, error: updateTripError.message },
        { status: 500 }
      );
    }

    try {
      await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "driver_offer_sent",
        message: "Trip offer sent to driver by admin",
        old_status: trip.status,
        new_status: "offered",
        created_by: user.id,
      });
    } catch {}

    const { data: driverAccount } = await supabaseAdmin
      .from("driver_accounts")
      .select("user_id")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (driverAccount?.user_id) {
      try {
        await sendPushToTargets({
          userIds: [driverAccount.user_id],
          role: "driver",
          title: "New Ride Request",
          body: `You have a trip offer from ${trip.pickup_address ?? "pickup"} to ${trip.dropoff_address ?? "destination"}.`,
          url: "/driver",
        });
      } catch {}
    }

    return NextResponse.json({
      ok: true,
      message: "Trip offer sent to driver successfully.",
      tripId,
      driverId,
      expiresAt,
      driverName: `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim(),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error.") },
      { status: 500 }
    );
  }
}
