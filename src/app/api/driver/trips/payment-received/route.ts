import { NextResponse } from "next/server";
import { getUserFromBearer } from "@/app/api/driver/utils";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in." }, { status: 401 });
    }

    const tripId = String((await req.json().catch(() => null))?.tripId ?? "").trim();
    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (accountError || !account?.driver_id) {
      return NextResponse.json({ ok: false, error: "Driver account is not linked." }, { status: 403 });
    }

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,status,driver_id,fare_amount,payment_method")
      .eq("id", tripId)
      .eq("driver_id", account.driver_id)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ ok: false, error: "Completed trip not found." }, { status: 404 });
    }
    if (trip.status !== "completed") {
      return NextResponse.json({ ok: false, error: "Payment can only be confirmed after trip completion." }, { status: 400 });
    }

    const { data: existing } = await supabaseAdmin
      .from("trip_events")
      .select("id")
      .eq("trip_id", tripId)
      .eq("event_type", "cash_payment_received")
      .limit(1)
      .maybeSingle();

    if (!existing) {
      const finalFare = Number(trip.fare_amount ?? 0);
      const { error: eventError } = await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "cash_payment_received",
        message: `Driver confirmed receipt of ${trip.payment_method ?? "cash"} payment of R${finalFare.toFixed(2)}.`,
        old_status: "completed",
        new_status: "completed",
      });
      if (eventError) {
        console.error("[driver-payment-received] event insert failed", {
          tripId,
          driverId: account.driver_id,
          reason: eventError.message,
        });
        return NextResponse.json({ ok: false, error: "Could not record payment receipt." }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, message: "Payment receipt confirmed." });
  } catch (error: unknown) {
    console.error("[driver-payment-received] unexpected failure", error);
    return NextResponse.json({ ok: false, error: "Could not confirm payment receipt." }, { status: 500 });
  }
}
