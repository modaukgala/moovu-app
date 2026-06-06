import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";

function isMissingCancellationColumn(error: { message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return (
    message.includes("cancellation_") ||
    message.includes("cancelled_at") ||
    message.includes("stops") ||
    message.includes("final_fare") ||
    message.includes("final_add_stop_increase")
  );
}

export async function GET(req: Request) {
  const auth = await getAuthenticatedCustomer(req);

  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { data: trips, error } = await auth.supabaseAdmin
    .from("trips")
    .select(`
      id,
      pickup_address,
      dropoff_address,
      fare_amount,
      payment_method,
      distance_km,
      duration_min,
      status,
      created_at,
      driver_id,
      ride_type,
      stops,
      final_fare,
      final_add_stop_increase,
      stop_waiting_fee,
      cancel_reason,
      cancellation_reason,
      cancellation_type,
      cancelled_by,
      cancelled_at,
      cancellation_fee_amount,
      cancellation_driver_amount,
      cancellation_moovu_amount,
      cancellation_policy_code,
      start_otp_verified,
      end_otp_verified
    `)
    .eq("customer_id", auth.customer.id)
    .order("created_at", { ascending: false });

  if (error && isMissingCancellationColumn(error)) {
    const { data: legacyTrips, error: legacyError } = await auth.supabaseAdmin
      .from("trips")
      .select(`
        id,
        pickup_address,
        dropoff_address,
        fare_amount,
        payment_method,
        status,
        created_at,
        driver_id,
        cancel_reason,
        start_otp_verified,
        end_otp_verified
      `)
      .eq("customer_id", auth.customer.id)
      .order("created_at", { ascending: false });

    if (legacyError) {
      return NextResponse.json({ ok: false, error: legacyError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      trips: legacyTrips ?? [],
    });
  }

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    trips: trips ?? [],
  });
}
