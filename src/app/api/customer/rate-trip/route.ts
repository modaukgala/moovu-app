import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { rebuildDriverQualityMetrics } from "@/lib/quality/rebuildDriverQualityMetrics";

export async function POST(req: Request) {
  try {
    const auth = await getAuthenticatedCustomer(req);

    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json();

    const tripId = String(body?.tripId ?? "").trim();
    const rating = Number(body?.rating ?? 0);
    const comment = String(body?.comment ?? "").trim();

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID is required." },
        { status: 400 }
      );
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { ok: false, error: "Rating must be between 1 and 5." },
        { status: 400 }
      );
    }

    const { data: trip, error: tripError } = await auth.supabaseAdmin
      .from("trips")
      .select("id,status,customer_id,driver_id")
      .eq("id", tripId)
      .eq("customer_id", auth.customer.id)
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

    if (trip.status !== "completed") {
      return NextResponse.json(
        { ok: false, error: "Only completed trips can be rated." },
        { status: 400 }
      );
    }

    const { error: upsertError } = await auth.supabaseAdmin
      .from("trip_ratings")
      .upsert(
        {
          trip_id: tripId,
          customer_id: auth.customer.id,
          driver_id: trip.driver_id,
          rating,
          comment: comment || null,
        },
        { onConflict: "trip_id" }
      );

    if (upsertError) {
      return NextResponse.json(
        { ok: false, error: upsertError.message },
        { status: 500 }
      );
    }

    if (trip.driver_id) {
      await rebuildDriverQualityMetrics(trip.driver_id).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      message: "Thank you for rating your trip.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}