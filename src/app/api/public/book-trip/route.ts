import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const rider_name = String(body.rider_name ?? "").trim();
    const rider_phone = String(body.rider_phone ?? "").trim();

    const pickup_address = String(body.pickup_address ?? "").trim();
    const dropoff_address = String(body.dropoff_address ?? "").trim();

    const pickup_lat = Number(body.pickup_lat);
    const pickup_lng = Number(body.pickup_lng);

    const dropoff_lat =
      body.dropoff_lat == null ? null : Number(body.dropoff_lat);
    const dropoff_lng =
      body.dropoff_lng == null ? null : Number(body.dropoff_lng);

    const fare_amount = body.fare_amount ?? null;
    const payment_method = body.payment_method ?? "cash";

    if (!rider_name) {
      return NextResponse.json(
        { ok: false, error: "Missing rider name" },
        { status: 400 }
      );
    }

    if (!rider_phone) {
      return NextResponse.json(
        { ok: false, error: "Missing rider phone" },
        { status: 400 }
      );
    }

    if (!pickup_address || !dropoff_address) {
      return NextResponse.json(
        { ok: false, error: "Pickup and destination required" },
        { status: 400 }
      );
    }

    if (Number.isNaN(pickup_lat) || Number.isNaN(pickup_lng)) {
      return NextResponse.json(
        { ok: false, error: "Pickup coordinates are required" },
        { status: 400 }
      );
    }

    const { data: trip, error } = await supabaseAdmin
      .from("trips")
      .insert({
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
        status: "requested",
        offer_status: null,
        driver_id: null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    await supabaseAdmin.from("trip_events").insert({
      trip_id: trip.id,
      event_type: "booking_created",
      message: "Trip created from rider booking page",
      old_status: null,
      new_status: "requested",
    });

    // ADMIN PUSH
    await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/push/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: "admin",
        title: "🚕 New Ride Request",
        body: `${pickup_address} → ${dropoff_address}`,
        url: "/admin/trips",
      }),
    }).catch(() => null);

    // FIND NEAREST AVAILABLE DRIVERS
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const { data: drivers, error: driversErr } = await supabaseAdmin
      .from("drivers")
      .select(
        "id, first_name, last_name, phone, lat, lng, last_seen, online, busy, status, subscription_status"
      )
      .eq("online", true)
      .eq("busy", false)
      .eq("status", "approved")
      .eq("subscription_status", "active")
      .gte("last_seen", cutoff)
      .not("lat", "is", null)
      .not("lng", "is", null);

    if (!driversErr && drivers && drivers.length > 0) {
      const ranked = drivers
        .map((d: any) => ({
          ...d,
          distance_km: distanceKm(pickup_lat, pickup_lng, d.lat, d.lng),
        }))
        .filter((d: any) => d.distance_km <= 8)
        .sort((a: any, b: any) => a.distance_km - b.distance_km)
        .slice(0, 3);

      if (ranked.length > 0) {
        const firstDriver = ranked[0];

        await supabaseAdmin
          .from("trips")
          .update({
            status: "offered",
            offer_status: "pending",
            driver_id: firstDriver.id,
            offer_expires_at: new Date(Date.now() + 30 * 1000).toISOString(),
          })
          .eq("id", trip.id);

        await supabaseAdmin.from("trip_events").insert({
          trip_id: trip.id,
          event_type: "offer_created",
          message: `Nearby drivers ranked and top driver selected (${firstDriver.id})`,
          old_status: "requested",
          new_status: "offered",
        });

        const driverIds = ranked.map((d: any) => d.id);

        const { data: mappings } = await supabaseAdmin
          .from("driver_accounts")
          .select("user_id, driver_id")
          .in("driver_id", driverIds);

        const userIds =
          mappings?.map((m: any) => m.user_id).filter(Boolean) ?? [];

        if (userIds.length > 0) {
          await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/push/send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userIds,
              title: "🚖 Nearby Trip Available",
              body: `${pickup_address} → ${dropoff_address}`,
              url: "/driver",
            }),
          }).catch(() => null);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      tripId: trip.id,
      status: trip.status,
      fare_amount: trip.fare_amount,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}