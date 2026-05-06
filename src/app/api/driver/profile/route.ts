import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error.";
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 401 });
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mappingError) {
      return NextResponse.json({ ok: false, error: mappingError.message }, { status: 500 });
    }

    if (!mapping?.driver_id) {
      return NextResponse.json(
        { ok: false, error: "Your account is not linked to a driver yet." },
        { status: 400 }
      );
    }

    const driverId = mapping.driver_id;

    const [driverResult, profileResult] = await Promise.all([
      supabaseAdmin
        .from("drivers")
        .select(`
          id,
          first_name,
          last_name,
          phone,
          profile_completed,
          verification_status,
          vehicle_make,
          vehicle_model,
          vehicle_year,
          vehicle_color,
          vehicle_registration,
          vehicle_vin,
          vehicle_engine_number,
          seating_capacity
        `)
        .eq("id", driverId)
        .maybeSingle(),
      supabaseAdmin
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
        .maybeSingle(),
    ]);

    if (driverResult.error) {
      return NextResponse.json({ ok: false, error: driverResult.error.message }, { status: 500 });
    }

    if (profileResult.error) {
      return NextResponse.json({ ok: false, error: profileResult.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      driverId,
      driver: driverResult.data ?? null,
      profile: profileResult.data ?? null,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
