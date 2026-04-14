import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";

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
      status,
      created_at,
      driver_id,
      cancel_reason,
      start_otp_verified,
      end_otp_verified
    `)
    .eq("customer_id", auth.customer.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    trips: trips ?? [],
  });
}