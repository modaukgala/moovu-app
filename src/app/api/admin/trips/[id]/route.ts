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
        "id,driver_id,rider_name,rider_phone,pickup_address,dropoff_address,payment_method,fare_amount,estimated_fare,fare_adjustment_amount,status,cancel_reason,created_at,scheduled_for,ride_type,dispatch_started_at,driver_arrived_at,trip_started_at,offer_status,offer_expires_at,dispatch_state,dispatch_failure_reason,stops,original_fare,final_add_stop_increase,final_fare,stop_waiting_fee,actual_distance_km,actual_duration_min,commission_pct,commission_amount,driver_net_earnings,start_otp_verified,end_otp_verified,completed_without_end_otp,end_otp_bypass_reason,end_otp_bypass_note,completed_by,completed_at,admin_completion_reason,admin_completion_note,cancellation_fee_amount,cancellation_driver_amount,cancellation_moovu_amount,cancellation_reason,cancelled_by,cancelled_at,actual_fare_breakdown,fare_breakdown"
      )
      .eq("id", tripId)
      .maybeSingle();

    if (tripError) {
      console.error("[admin-trip-detail] failed to load trip", { tripId, error: tripError });
      return NextResponse.json(
        { ok: false, error: "Could not load trip details. Please refresh or contact admin support." },
        { status: 500 }
      );
    }

    if (!trip) {
      return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    }

    const [{ data: events, error: eventError }, { data: eligibleDrivers, error: driverError }, assignedDriverResult, offersResult] = await Promise.all([
      supabaseAdmin
        .from("trip_events")
        .select("id,event_type,message,old_status,new_status,created_at,created_by")
        .eq("trip_id", tripId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("drivers")
        .select("id,first_name,last_name,phone,status,online,busy")
        .in("status", ["approved", "active"])
        .order("created_at", { ascending: false }),
      trip.driver_id
        ? supabaseAdmin
            .from("drivers")
            .select("id,first_name,last_name,phone,status,online,busy")
            .eq("id", trip.driver_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabaseAdmin.from("driver_trip_offers")
        .select("id,driver_id,status,dispatch_cycle,sequence_number,offered_at,responded_at,expired_at,cancelled_at,accept_deadline_at,decline_reason,response_source")
        .eq("trip_id", tripId).order("offered_at", { ascending: false }).order("id", { ascending: false }),
    ]);

    if (eventError) {
      console.error("[admin-trip-detail] failed to load events", { tripId, error: eventError });
    }

    if (driverError) {
      console.error("[admin-trip-detail] failed to load drivers", { tripId, error: driverError });
    }
    if (offersResult.error) console.error("[admin-trip-detail] failed to load offers", { tripId, error: offersResult.error });

    const drivers = [...(eligibleDrivers ?? [])];
    if (assignedDriverResult.data && !drivers.some((driver) => driver.id === assignedDriverResult.data?.id)) {
      drivers.push(assignedDriverResult.data);
    }

    return NextResponse.json({
      ok: true,
      trip,
      events: events ?? [],
      drivers,
      offers: offersResult.error ? [] : offersResult.data ?? [],
      context_errors: {
        events: eventError ? "Trip timeline is unavailable." : null,
        drivers: driverError || assignedDriverResult.error ? "Driver context is unavailable." : null,
        offers: offersResult.error ? "Dispatch offer history is unavailable." : null,
      },
    });
  } catch (error: unknown) {
    console.error("[admin-trip-detail] unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not load trip details. Please refresh or contact admin support." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { id } = await context.params;
    const tripId = String(id ?? "").trim();
    const body = await req.json();
    const status = String(body?.status ?? "").trim();

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    }

    if (status !== "arrived") {
      return NextResponse.json({ ok: false, error: "Unsupported trip update." }, { status: 400 });
    }

    const { supabaseAdmin, user } = auth;

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,status")
      .eq("id", tripId)
      .maybeSingle();

    if (tripError) {
      console.error("[admin-trip-detail] failed to load trip before update", { tripId, error: tripError });
      return NextResponse.json(
        { ok: false, error: "Could not update trip. Please try again." },
        { status: 500 }
      );
    }

    if (!trip) {
      return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    }

    if (trip.status !== "assigned") {
      return NextResponse.json(
        { ok: false, error: "Only assigned trips can be marked arrived by admin." },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("trips")
      .update({
        status: "arrived",
        driver_arrived_at: new Date().toISOString(),
      })
      .eq("id", tripId);

    if (updateError) {
      console.error("[admin-trip-detail] failed to update trip", { tripId, error: updateError });
      return NextResponse.json(
        { ok: false, error: "Could not update trip. Please try again." },
        { status: 500 }
      );
    }

    await supabaseAdmin.from("trip_events").insert({
      trip_id: tripId,
      event_type: "admin_marked_arrived",
      message: "Trip marked arrived by admin",
      old_status: trip.status,
      new_status: "arrived",
      created_by: user.id,
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("[admin-trip-detail] update unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not update trip. Please try again." },
      { status: 500 }
    );
  }
}
