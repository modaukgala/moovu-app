import { NextResponse } from "next/server";
import { getDriverIdForUser, getUserFromBearer } from "@/app/api/driver/utils";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Please sign in as a driver." }, { status: 401 });
    }

    const driverId = await getDriverIdForUser(user.id);
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Driver account is not linked yet." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const tripId = String(body?.tripId ?? "").trim();
    const rating = Number(body?.rating ?? 0);
    const comment = String(body?.comment ?? "").trim();

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ ok: false, error: "Rating must be between 1 and 5." }, { status: 400 });
    }

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,status,customer_id,driver_id")
      .eq("id", tripId)
      .eq("driver_id", driverId)
      .maybeSingle();

    if (tripError) {
      console.error("[driver-rate-customer] trip lookup failed", tripError);
      return NextResponse.json({ ok: false, error: "Could not load this trip." }, { status: 500 });
    }

    if (!trip) {
      return NextResponse.json({ ok: false, error: "Trip not found for this driver." }, { status: 404 });
    }

    if (trip.status !== "completed") {
      return NextResponse.json({ ok: false, error: "Only completed trips can be rated." }, { status: 400 });
    }

    const duplicateCheck = await supabaseAdmin
      .from("trip_ratings")
      .select("id")
      .eq("trip_id", tripId)
      .eq("reviewer_role", "driver")
      .maybeSingle();

    if (isMissingRatingRoleColumn(duplicateCheck.error)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Driver-to-customer ratings need the ratings SQL migration before they can be saved.",
        },
        { status: 400 }
      );
    }

    if (duplicateCheck.error) {
      console.error("[driver-rate-customer] duplicate check failed", duplicateCheck.error);
      return NextResponse.json({ ok: false, error: "Could not check existing rating." }, { status: 500 });
    }

    if (duplicateCheck.data?.id) {
      return NextResponse.json({ ok: false, error: "You have already rated this customer." }, { status: 409 });
    }

    const { error: insertError } = await supabaseAdmin.from("trip_ratings").insert({
      trip_id: tripId,
      customer_id: trip.customer_id,
      driver_id: driverId,
      reviewer_id: driverId,
      reviewer_role: "driver",
      reviewee_id: trip.customer_id,
      reviewee_role: "customer",
      rating,
      comment: comment || null,
    });

    if (insertError) {
      console.error("[driver-rate-customer] insert failed", insertError);
      return NextResponse.json({ ok: false, error: "Could not save your rating. Please try again." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: "Customer rating saved." });
  } catch (error: unknown) {
    console.error("[driver-rate-customer] unexpected error", error);
    return NextResponse.json({ ok: false, error: "Could not save this rating." }, { status: 500 });
  }
}
