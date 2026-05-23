import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { id } = await context.params;
    const tripId = String(id ?? "").trim();

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    }

    const { supabaseAdmin } = auth;

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select(
        "id,rider_name,rider_phone,pickup_address,dropoff_address,payment_method,fare_amount,distance_km,duration_min,status,created_at,completed_at,cancelled_at,driver_id"
      )
      .eq("id", tripId)
      .maybeSingle();

    if (tripError) {
      console.error("[admin-receipt-detail] failed to load trip", { tripId, error: tripError });
      return NextResponse.json(
        { ok: false, error: "Could not load receipt. Please refresh or contact admin support." },
        { status: 500 }
      );
    }

    if (!trip) {
      return NextResponse.json({ ok: false, error: "Receipt not found." }, { status: 404 });
    }

    let driver = null;
    if (trip.driver_id) {
      const { data: driverRow, error: driverError } = await supabaseAdmin
        .from("drivers")
        .select(
          "id,first_name,last_name,phone,vehicle_make,vehicle_model,vehicle_year,vehicle_color,vehicle_registration"
        )
        .eq("id", trip.driver_id)
        .maybeSingle();

      if (driverError) {
        console.error("[admin-receipt-detail] failed to load driver", {
          tripId,
          driverId: trip.driver_id,
          error: driverError,
        });
      } else {
        driver = driverRow;
      }
    }

    return NextResponse.json({ ok: true, trip, driver });
  } catch (error: unknown) {
    console.error("[admin-receipt-detail] unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not load receipt. Please refresh or contact admin support." },
      { status: 500 }
    );
  }
}
