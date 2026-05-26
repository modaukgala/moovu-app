import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDriverIdForUser, getUserFromBearer } from "@/app/api/driver/utils";

const ACTIVE = ["assigned", "arrived", "ongoing"];
const TRIP_SELECT =
  "id,status,driver_id,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,fare_amount,payment_method,created_at,offer_status,offer_expires_at,ride_option,stops,original_fare,final_add_stop_increase,final_fare,stop_waiting_fee";
const LEGACY_TRIP_SELECT =
  "id,status,driver_id,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,fare_amount,payment_method,created_at,offer_status,offer_expires_at,ride_option";

function isMissingStopsColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42703" && (
    message.includes("stops") ||
    message.includes("original_fare") ||
    message.includes("final_add_stop_increase") ||
    message.includes("final_fare") ||
    message.includes("stop_waiting_fee")
  );
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not logged in" },
        { status: 401 }
      );
    }

    const driverId = await getDriverIdForUser(user.id);
    if (!driverId) {
      return NextResponse.json(
        { ok: false, error: "Not linked" },
        { status: 403 }
      );
    }

    await supabaseAdmin.rpc("refresh_driver_subscription", { did: driverId });

    let tripQuery = await supabaseAdmin
      .from("trips")
      .select(TRIP_SELECT)
      .eq("driver_id", driverId)
      .in("status", ACTIVE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (isMissingStopsColumn(tripQuery.error)) {
      tripQuery = await supabaseAdmin
        .from("trips")
        .select(LEGACY_TRIP_SELECT)
        .eq("driver_id", driverId)
        .in("status", ACTIVE)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    }

    const { data: trip, error } = tripQuery;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, trip: trip ?? null });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
