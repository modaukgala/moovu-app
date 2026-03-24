import { NextResponse } from "next/server";
import { offerNextEligibleDriver } from "@/lib/trip-offers";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const tripId = String(body?.tripId ?? "").trim();
    const excludeDriverIds = Array.isArray(body?.excludeDriverIds)
      ? body.excludeDriverIds.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID is required." },
        { status: 400 }
      );
    }

    const { data: trip, error: tripErr } = await supabaseAdmin
      .from("trips")
      .select("id,status,driver_id,offer_status,offer_expires_at")
      .eq("id", tripId)
      .maybeSingle();

    if (tripErr) {
      return NextResponse.json(
        { ok: false, error: tripErr.message },
        { status: 500 }
      );
    }

    if (!trip) {
      return NextResponse.json(
        { ok: false, error: "Trip not found." },
        { status: 404 }
      );
    }

    if (trip.status === "cancelled" || trip.status === "completed") {
      return NextResponse.json(
        { ok: false, error: "Trip is already closed." },
        { status: 400 }
      );
    }

    const result = await offerNextEligibleDriver(tripId, excludeDriverIds);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error || "Failed to auto-assign driver.",
          exhausted: "exhausted" in result ? result.exhausted : false,
          excluded: "excluded" in result ? result.excluded : [],
        },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}