import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { rebuildDriverQualityMetrics } from "@/lib/quality/rebuildDriverQualityMetrics";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isMissingRatingRoleColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42703" && (
    message.includes("reviewer_role") ||
    message.includes("reviewee_role") ||
    message.includes("reviewer_id") ||
    message.includes("reviewee_id")
  );
}

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

    let duplicateCheck = await auth.supabaseAdmin
      .from("trip_ratings")
      .select("id")
      .eq("trip_id", tripId)
      .eq("reviewer_role", "customer")
      .maybeSingle();

    if (isMissingRatingRoleColumn(duplicateCheck.error)) {
      duplicateCheck = await auth.supabaseAdmin
        .from("trip_ratings")
        .select("id")
        .eq("trip_id", tripId)
        .maybeSingle();
    }

    if (duplicateCheck.error) {
      return NextResponse.json(
        { ok: false, error: "Could not check existing rating. Please try again." },
        { status: 500 }
      );
    }

    if (duplicateCheck.data?.id) {
      return NextResponse.json(
        { ok: false, error: "You have already rated this trip." },
        { status: 409 }
      );
    }

    const ratingPayload = {
      trip_id: tripId,
      customer_id: auth.customer.id,
      driver_id: trip.driver_id,
      reviewer_id: auth.customer.id,
      reviewer_role: "customer",
      reviewee_id: trip.driver_id,
      reviewee_role: "driver",
      rating,
      comment: comment || null,
    };

    let insertResult = await auth.supabaseAdmin
      .from("trip_ratings")
      .insert(ratingPayload);

    if (isMissingRatingRoleColumn(insertResult.error)) {
      insertResult = await auth.supabaseAdmin
        .from("trip_ratings")
        .insert({
          trip_id: tripId,
          customer_id: auth.customer.id,
          driver_id: trip.driver_id,
          rating,
          comment: comment || null,
        });
    }

    if (insertResult.error) {
      return NextResponse.json(
        { ok: false, error: "Could not save your rating. Please try again." },
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
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error.") },
      { status: 500 }
    );
  }
}
