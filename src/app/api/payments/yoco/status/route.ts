import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { isUuid } from "@/lib/payments/onlinePayment";

export async function GET(req: Request) {
  const auth = await getAuthenticatedCustomer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const tripId = new URL(req.url).searchParams.get("tripId");
  if (!isUuid(tripId)) return NextResponse.json({ ok: false, error: "A valid trip ID is required." }, { status: 400 });

  const { data: trip } = await auth.supabaseAdmin.from("trips")
    .select("id,pickup_address,dropoff_address")
    .eq("id", tripId).eq("customer_id", auth.customer.id).maybeSingle();
  if (!trip) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });

  const { data: attempt, error } = await auth.supabaseAdmin.from("online_payment_attempts")
    .select("state,amount_cents,currency,reconciliation_state,verified_at")
    .eq("trip_id", tripId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: "Payment status is unavailable." }, { status: 503 });
  return NextResponse.json({ ok: true, payment: {
    state: attempt?.state ?? null,
    amountCents: attempt ? Number(attempt.amount_cents) : null,
    currency: attempt?.currency ?? null,
    reconciliationState: attempt?.reconciliation_state ?? null,
    verified: Boolean(attempt?.verified_at),
    context: `${trip.pickup_address ?? "Pickup"} to ${trip.dropoff_address ?? "destination"}`,
  } });
}
