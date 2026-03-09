import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tripId = String(url.searchParams.get("tripId") ?? "").trim();

    if (!tripId) return NextResponse.json({ ok: false, error: "Missing tripId" }, { status: 400 });

    const { data: trip, error: tErr } = await supabaseAdmin
      .from("trips")
      .select("id,driver_id,status,offer_status,offer_expires_at,pickup_address,dropoff_address,fare_amount")
      .eq("id", tripId)
      .single();

    if (tErr || !trip) {
      return NextResponse.json({ ok: false, error: tErr?.message ?? "Trip not found" }, { status: 404 });
    }

    if (!trip.driver_id) {
      return NextResponse.json({ ok: false, error: "Trip has no driver assigned yet" }, { status: 400 });
    }

    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id,first_name,last_name,phone")
      .eq("id", trip.driver_id)
      .single();

    if (dErr || !driver) {
      return NextResponse.json({ ok: false, error: dErr?.message ?? "Driver not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      trip: {
        id: trip.id,
        status: trip.status,
        offer_status: trip.offer_status,
        offer_expires_at: trip.offer_expires_at,
        pickup_address: trip.pickup_address,
        dropoff_address: trip.dropoff_address,
        fare_amount: trip.fare_amount,
      },
      driver: {
        id: driver.id,
        first_name: driver.first_name,
        last_name: driver.last_name,
        phone: driver.phone,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}