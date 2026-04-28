import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromBearer } from "@/app/api/driver/utils";
import { expirePendingOfferIfNeeded, offerNextEligibleDriver } from "@/lib/trip-offers";

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });

    const { data: mapping, error: mErr } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .single();

    if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });

    const driverId = mapping?.driver_id ?? null;
    if (!driverId) return NextResponse.json({ ok: false, error: "Not linked" }, { status: 403 });

    // Refresh subscription if expired
    await supabaseAdmin.rpc("refresh_driver_subscription", { did: driverId });

    // Check eligibility
    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id,online,status,subscription_status")
      .eq("id", driverId)
      .single();

    if (dErr || !driver) return NextResponse.json({ ok: false, error: "Driver record not found" }, { status: 404 });

    if (!driver.online) {
      return NextResponse.json({ ok: true, offers: [], info: "You are offline" });
    }

    if (driver.subscription_status !== "active" && driver.subscription_status !== "grace") {
      return NextResponse.json({ ok: true, offers: [], info: "Subscription inactive" });
    }

    // Fetch pending offers for this driver
    const { data: trips, error } = await supabaseAdmin
      .from("trips")
      .select("id,status,offer_status,offer_expires_at,pickup_address,dropoff_address,fare_amount")
      .eq("driver_id", driverId)
      .eq("offer_status", "pending")
      .eq("status", "offered")
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    // Expire overdue offers and auto re-offer next
    for (const t of trips ?? []) {
      const expired = await expirePendingOfferIfNeeded(t.id);
      if (expired.expired) {
        await offerNextEligibleDriver(t.id, [driverId]);
      }
    }

    // Re-fetch after expiry cleanup
    const { data: fresh, error: fErr } = await supabaseAdmin
      .from("trips")
      .select("id,status,offer_status,offer_expires_at,pickup_address,dropoff_address,fare_amount")
      .eq("driver_id", driverId)
      .eq("offer_status", "pending")
      .eq("status", "offered")
      .order("created_at", { ascending: false })
      .limit(5);

    if (fErr) return NextResponse.json({ ok: false, error: fErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, offers: fresh ?? [] });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
