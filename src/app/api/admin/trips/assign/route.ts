import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { dispatchTrip } from "@/lib/dispatch/dispatchTrip";
import { isDispatchExpired } from "@/lib/dispatch/config";

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

    const { supabaseAdmin } = auth;
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
      .select("id,status,driver_id,created_at,dispatch_cycle")
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

    if (!["requested", "offered"].includes(String(trip.status)) || trip.driver_id) {
      return NextResponse.json(
        { ok: false, error: "Only unassigned requested trips can be offered to a driver." },
        { status: 400 }
      );
    }

    if (isDispatchExpired(trip.created_at)) {
      return NextResponse.json(
        { ok: false, error: "Dispatch window expired. Trips can only be re-offered within 30 minutes of the original request." },
        { status: 410 }
      );
    }

    const atomicResult = await dispatchTrip({
      tripId,
      preferredDriverId: driverId,
      cycle: Math.max(1, Number(trip.dispatch_cycle ?? 0) + 1),
      allowAfterAutomaticExhaustion: true,
    });
    if (atomicResult.ok) {
      return NextResponse.json({
        ok: true,
        message: "Trip offer sent to driver successfully.",
        tripId,
        driverId: atomicResult.driverId,
        expiresAt: atomicResult.expiresAt,
        dispatchMode: atomicResult.mode,
      });
    }

    console.error("[admin-assign] atomic dispatch manual offer failed", {
      tripId,
      driverId,
      reason: atomicResult.error,
    });
    return NextResponse.json(
      {
        ok: false,
        error: atomicResult.error ?? "Could not send an atomic trip offer to this driver.",
        dispatchMode: "atomic",
      },
      { status: atomicResult.error?.includes("migration") ? 503 : 400 },
    );
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error.") },
      { status: 500 }
    );
  }
}
