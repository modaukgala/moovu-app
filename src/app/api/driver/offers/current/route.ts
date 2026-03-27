import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { expirePendingOfferIfNeeded, offerNextEligibleDriver } from "@/lib/trip-offers";

async function getUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  // @ts-ignore
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

export async function GET(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }

    const { data: mapping, error: mErr } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mErr) {
      return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
    }

    const driverId = mapping?.driver_id ?? null;
    if (!driverId) {
      return NextResponse.json({
        ok: false,
        code: "NOT_LINKED",
        error: "Your account is not linked to a driver yet.",
      });
    }

    await supabaseAdmin.rpc("refresh_driver_subscription", { did: driverId });

    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id,online,status,subscription_status")
      .eq("id", driverId)
      .maybeSingle();

    if (dErr || !driver) {
      return NextResponse.json({ ok: false, error: "Driver record not found" }, { status: 404 });
    }

    if (!driver.online) {
      return NextResponse.json({ ok: true, offer: null, info: "You are offline" });
    }

    if (driver.subscription_status !== "active" && driver.subscription_status !== "grace") {
      return NextResponse.json({ ok: true, offer: null, info: "Subscription inactive" });
    }

    const { data: trips, error } = await supabaseAdmin
      .from("trips")
      .select("id,status,offer_status,offer_expires_at,pickup_address,dropoff_address,fare_amount,payment_method")
      .eq("driver_id", driverId)
      .eq("offer_status", "pending")
      .eq("status", "offered")
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    for (const t of trips ?? []) {
      const expired = await expirePendingOfferIfNeeded(t.id);
      if (expired.expired) {
        await offerNextEligibleDriver(t.id, [driverId]);
      }
    }

    const { data: fresh, error: fErr } = await supabaseAdmin
      .from("trips")
      .select("id,status,offer_status,offer_expires_at,pickup_address,dropoff_address,fare_amount,payment_method")
      .eq("driver_id", driverId)
      .eq("offer_status", "pending")
      .eq("status", "offered")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fErr) {
      return NextResponse.json({ ok: false, error: fErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, offer: fresh ?? null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}