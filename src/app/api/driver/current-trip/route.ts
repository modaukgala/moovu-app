import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { noShowEligibleAt } from "@/lib/finance/cancellationFees";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error.";
}

type DriverCurrentTripResponse = {
  id: string;
  status: string;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  fare_amount: number | null;
  payment_method: string | null;
  rider_name?: string | null;
  rider_phone?: string | null;
  created_at: string | null;
  driver_arrived_at?: string | null;
  no_show_eligible_at?: string | null;
  stops?: unknown;
  original_fare?: number | null;
  final_add_stop_increase?: number | null;
  final_fare?: number | null;
  stop_waiting_fee?: number | null;
};

const CURRENT_TRIP_SELECT = `
  id,
  status,
  driver_id,
  pickup_address,
  dropoff_address,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  fare_amount,
  payment_method,
  rider_name,
  rider_phone,
  created_at,
  ride_option,
  stops,
  original_fare,
  final_add_stop_increase,
  final_fare,
  stop_waiting_fee
`;

const LEGACY_CURRENT_TRIP_SELECT = `
  id,
  status,
  driver_id,
  pickup_address,
  dropoff_address,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  fare_amount,
  payment_method,
  rider_name,
  rider_phone,
  created_at
`;

function isMissingStopsColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42703" && (
    message.includes("stops") ||
    message.includes("original_fare") ||
    message.includes("final_add_stop_increase") ||
    message.includes("final_fare") ||
    message.includes("stop_waiting_fee") ||
    message.includes("ride_option")
  );
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing access token." },
        { status: 401 }
      );
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mappingError || !mapping?.driver_id) {
      return NextResponse.json({ ok: true, trip: null });
    }

    let tripQuery = await supabaseAdmin
      .from("trips")
      .select(CURRENT_TRIP_SELECT)
      .eq("driver_id", mapping.driver_id)
      .in("status", ["assigned", "arrived", "ongoing"])
      .order("created_at", { ascending: false })
      .maybeSingle();

    if (isMissingStopsColumn(tripQuery.error)) {
      tripQuery = await supabaseAdmin
        .from("trips")
        .select(LEGACY_CURRENT_TRIP_SELECT)
        .eq("driver_id", mapping.driver_id)
        .in("status", ["assigned", "arrived", "ongoing"])
        .order("created_at", { ascending: false })
        .maybeSingle();
    }

    const { data: trip, error: tripError } = tripQuery;

    if (tripError) {
      return NextResponse.json(
        { ok: false, error: tripError.message },
        { status: 500 }
      );
    }

    let enrichedTrip = (trip as DriverCurrentTripResponse | null) ?? null;

    if (enrichedTrip?.id && enrichedTrip.status === "arrived") {
      const { data: arrivedEvents } = await supabaseAdmin
        .from("trip_events")
        .select("created_at")
        .eq("trip_id", enrichedTrip.id)
        .eq("event_type", "driver_arrived")
        .order("created_at", { ascending: false })
        .limit(1);

      enrichedTrip = {
        ...enrichedTrip,
        driver_arrived_at: arrivedEvents?.[0]?.created_at ?? null,
        no_show_eligible_at: noShowEligibleAt(arrivedEvents?.[0]?.created_at ?? null),
      };
    }

    return NextResponse.json({
      ok: true,
      trip: enrichedTrip,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
