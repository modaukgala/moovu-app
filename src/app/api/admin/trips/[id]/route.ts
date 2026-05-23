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
      .select("*")
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

    const [{ data: events, error: eventError }, { data: drivers, error: driverError }] = await Promise.all([
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
    ]);

    if (eventError) {
      console.error("[admin-trip-detail] failed to load events", { tripId, error: eventError });
    }

    if (driverError) {
      console.error("[admin-trip-detail] failed to load drivers", { tripId, error: driverError });
    }

    return NextResponse.json({
      ok: true,
      trip,
      events: events ?? [],
      drivers: drivers ?? [],
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
