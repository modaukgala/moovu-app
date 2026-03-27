import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function getUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  // @ts-ignore
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

function isValidLatLng(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }

    const { lat, lng } = await req.json();

    if (typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ ok: false, error: "lat/lng must be numbers" }, { status: 400 });
    }

    if (!isValidLatLng(lat, lng)) {
      return NextResponse.json({ ok: false, error: "Invalid coordinates" }, { status: 400 });
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
      return NextResponse.json({ ok: false, code: "NOT_LINKED", error: "Not linked" }, { status: 403 });
    }

    await supabaseAdmin.rpc("refresh_driver_subscription", { did: driverId });

    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id,online,subscription_status")
      .eq("id", driverId)
      .maybeSingle();

    if (dErr || !driver) {
      return NextResponse.json({ ok: false, error: "Driver not found" }, { status: 404 });
    }

    if (!driver.online) {
      return NextResponse.json({ ok: false, error: "Driver is offline" }, { status: 400 });
    }

    if (driver.subscription_status !== "active" && driver.subscription_status !== "grace") {
      return NextResponse.json({ ok: false, error: "Subscription inactive" }, { status: 402 });
    }

    const { error: upErr } = await supabaseAdmin
      .from("drivers")
      .update({
        lat,
        lng,
        last_seen: new Date().toISOString(),
      })
      .eq("id", driverId);

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}