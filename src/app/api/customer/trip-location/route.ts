import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";

export async function GET(req: Request) {
  try {
    const auth = await getAuthenticatedCustomer(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const tripId = new URL(req.url).searchParams.get("tripId")?.trim() ?? "";
    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Missing tripId." }, { status: 400 });
    }

    const { data: trip, error: tripError } = await auth.supabaseAdmin
      .from("trips")
      .select("id,status,driver_id,current_fare,final_fare,fare_amount,actual_distance_km,actual_duration_min")
      .eq("id", tripId)
      .eq("customer_id", auth.customer.id)
      .maybeSingle();
    if (tripError) return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
    if (!trip) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });

    let location: { lat: number | null; lng: number | null; heading: number | null; last_seen: string | null } | null = null;
    if (trip.driver_id && ["assigned", "arrived", "ongoing"].includes(String(trip.status))) {
      const { data: liveLocation } = await auth.supabaseAdmin
        .from("trip_live_locations")
        .select("lat,lng,heading,recorded_at")
        .eq("trip_id", tripId)
        .eq("driver_id", trip.driver_id)
        .maybeSingle();

      if (liveLocation) {
        location = {
          lat: Number(liveLocation.lat),
          lng: Number(liveLocation.lng),
          heading: liveLocation.heading == null ? null : Number(liveLocation.heading),
          last_seen: liveLocation.recorded_at,
        };
      } else {
        const { data: driver } = await auth.supabaseAdmin
          .from("drivers")
          .select("lat,lng,last_seen")
          .eq("id", trip.driver_id)
          .maybeSingle();
        location = driver
          ? {
              lat: driver.lat == null ? null : Number(driver.lat),
              lng: driver.lng == null ? null : Number(driver.lng),
              heading: null,
              last_seen: driver.last_seen,
            }
          : null;
      }
    }

    return NextResponse.json({
      ok: true,
      status: trip.status,
      location,
      fare: {
        current_fare: trip.current_fare,
        final_fare: trip.final_fare,
        fare_amount: trip.fare_amount,
        actual_distance_km: trip.actual_distance_km,
        actual_duration_min: trip.actual_duration_min,
      },
    });
  } catch (error: unknown) {
    console.error("[customer-trip-location] failed", error);
    return NextResponse.json({ ok: false, error: "Could not refresh live trip location." }, { status: 500 });
  }
}
