import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tripId = String(url.searchParams.get("tripId") ?? "").trim();

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Missing tripId" }, { status: 400 });
    }

    const { data: trip, error: tErr } = await supabaseAdmin
      .from("trips")
      .select(
        `
        id,
        rider_name,
        rider_phone,
        driver_id,
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
        cancel_reason,
        created_at
      `
      )
      .eq("id", tripId)
      .single();

    if (tErr || !trip) {
      return NextResponse.json({ ok: false, error: tErr?.message ?? "Trip not found" }, { status: 404 });
    }

    let driver = null;

    if (trip.driver_id) {
      const { data: d } = await supabaseAdmin
        .from("drivers")
        .select(
          `
          id,
          first_name,
          last_name,
          phone,
          online,
          busy,
          status,
          lat,
          lng,
          last_seen,
          vehicle_registration,
          vehicle_color,
          vehicle_make,
          vehicle_model
        `
        )
        .eq("id", trip.driver_id)
        .single();

      if (d) {
        driver = {
          id: d.id,
          name: `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Driver",
          phone: d.phone ?? null,
          online: d.online ?? null,
          busy: d.busy ?? null,
          status: d.status ?? null,
          lat: d.lat ?? null,
          lng: d.lng ?? null,
          last_seen: d.last_seen ?? null,
          vehicle_registration: d.vehicle_registration ?? null,
          vehicle_color: d.vehicle_color ?? null,
          vehicle_make: d.vehicle_make ?? null,
          vehicle_model: d.vehicle_model ?? null,
        };
      }
    }

    return NextResponse.json({
      ok: true,
      trip: {
        id: trip.id,
        rider_name: trip.rider_name ?? null,
        rider_phone: trip.rider_phone ?? null,
        pickup_address: trip.pickup_address ?? null,
        dropoff_address: trip.dropoff_address ?? null,
        pickup_lat: trip.pickup_lat ?? null,
        pickup_lng: trip.pickup_lng ?? null,
        dropoff_lat: trip.dropoff_lat ?? null,
        dropoff_lng: trip.dropoff_lng ?? null,
        fare_amount: trip.fare_amount ?? null,
        payment_method: trip.payment_method ?? null,
        status: trip.status,
        offer_status: trip.offer_status ?? null,
        offer_expires_at: trip.offer_expires_at ?? null,
        cancel_reason: trip.cancel_reason ?? null,
        created_at: trip.created_at,
      },
      driver,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}