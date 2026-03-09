import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDriverIdForUser, getUserFromBearer } from "@/app/api/driver/utils";

const ACTIVE = ["assigned", "arrived", "started"];

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });

    const driverId = await getDriverIdForUser(user.id);
    if (!driverId) return NextResponse.json({ ok: false, error: "Not linked" }, { status: 403 });

    await supabaseAdmin.rpc("refresh_driver_subscription", { did: driverId });

    const { data: trip, error } = await supabaseAdmin
      .from("trips")
      .select(
        "id,status,driver_id,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,fare_amount,payment_method,created_at,offer_status,offer_expires_at"
      )
      .eq("driver_id", driverId)
      .in("status", ACTIVE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, trip: trip ?? null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}