import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

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

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { supabaseAdmin } = auth;

    const tripQuery = await supabaseAdmin
      .from("trips")
      .select(`
        id,
        rider_name,
        rider_phone,
        pickup_address,
        dropoff_address,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        fare_amount,
        payment_method,
        status,
        offer_status,
        offer_expires_at,
        driver_id,
        created_at,
        commission_pct,
        commission_amount,
        driver_net_earnings,
        stops,
        original_fare,
        final_add_stop_increase,
        final_fare,
        stop_waiting_fee
      `)
      .order("created_at", { ascending: false });

    let data: unknown[] | null = tripQuery.data;
    let error = tripQuery.error;

    if (isMissingStopsColumn(error)) {
      const legacyQuery = await supabaseAdmin
        .from("trips")
        .select(`
          id,
          rider_name,
          rider_phone,
          pickup_address,
          dropoff_address,
          pickup_lat,
          pickup_lng,
          dropoff_lat,
          dropoff_lng,
          fare_amount,
          payment_method,
          status,
          offer_status,
          offer_expires_at,
          driver_id,
          created_at,
          commission_pct,
          commission_amount,
          driver_net_earnings
        `)
        .order("created_at", { ascending: false });
      data = legacyQuery.data;
      error = legacyQuery.error;
    }

    if (error) {
      console.error("[admin-trips-list] failed to load trips", error);
      return NextResponse.json(
        { ok: false, error: "Could not load trips. Please refresh or contact admin support." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      trips: data ?? [],
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Failed to load trips.") },
      { status: 500 }
    );
  }
}
