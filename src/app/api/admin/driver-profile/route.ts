import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;
    const driverId = req.nextUrl.searchParams.get("driverId");

    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Missing driverId" }, { status: 400 });
    }

    const { data: driver, error: driverErr } = await supabaseAdmin
      .from("drivers")
      .select(`
        id,
        first_name,
        last_name,
        phone,
        email,
        status,
        online,
        busy,
        profile_completed,
        verification_status,
        vehicle_make,
        vehicle_model,
        vehicle_year,
        vehicle_color,
        vehicle_registration,
        vehicle_vin,
        vehicle_engine_number,
        seating_capacity,
        subscription_status,
        subscription_plan,
        subscription_expires_at,
        created_at
      `)
      .eq("id", driverId)
      .maybeSingle();

    if (driverErr) {
      return NextResponse.json({ ok: false, error: driverErr.message }, { status: 500 });
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("driver_profiles")
      .select(`
        driver_id,
        first_name,
        last_name,
        phone,
        alt_phone,
        id_number,
        home_address,
        area_name,
        emergency_contact_name,
        emergency_contact_phone,
        license_number,
        license_code,
        license_expiry,
        pdp_number,
        pdp_expiry,
        profile_completed,
        submitted_at,
        updated_at
      `)
      .eq("driver_id", driverId)
      .maybeSingle();

    if (profileErr) {
      return NextResponse.json({ ok: false, error: profileErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      profile: {
        ...(driver ?? {}),
        driver_profile: profile ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}