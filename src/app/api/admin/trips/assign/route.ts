import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { dispatchTrip } from "@/lib/dispatch/dispatchTrip";

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
      .select("id,status,driver_id")
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

    const atomicResult = await dispatchTrip({
      tripId,
      preferredDriverId: driverId,
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
