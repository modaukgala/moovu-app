import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const VALID_REASONS = [
  "Driver is taking too long",
  "Booked by mistake",
  "Changed my plans",
  "Found another ride",
  "Pickup location issue",
  "Other",
];

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const tripId = String(body?.tripId ?? "").trim();
    const reason = String(body?.reason ?? "").trim();

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID is required." },
        { status: 400 }
      );
    }

    if (!VALID_REASONS.includes(reason)) {
      return NextResponse.json(
        { ok: false, error: "Please select a valid cancellation reason." },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id,status")
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

    if (trip.status === "completed") {
      return NextResponse.json(
        { ok: false, error: "Completed trips cannot be cancelled." },
        { status: 400 }
      );
    }

    if (trip.status === "cancelled") {
      return NextResponse.json(
        { ok: false, error: "Trip is already cancelled." },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabase
      .from("trips")
      .update({
        status: "cancelled",
        cancel_reason: reason,
      })
      .eq("id", tripId);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      );
    }

    try {
      await supabase.from("trip_events").insert({
        trip_id: tripId,
        event_type: "trip_cancelled",
        message: `Trip cancelled by rider. Reason: ${reason}`,
        old_status: trip.status,
        new_status: "cancelled",
      });
    } catch {
      // ignore trip_events logging failure
    }

    return NextResponse.json({
      ok: true,
      message: "Trip cancelled successfully.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}