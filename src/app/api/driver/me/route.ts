import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error";
}

async function getUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
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

    const { data: mapping, error: mapErr } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mapErr) {
      return NextResponse.json({ ok: false, error: mapErr.message }, { status: 500 });
    }

    if (!mapping?.driver_id) {
      return NextResponse.json({
        ok: false,
        code: "NOT_LINKED",
        error: "Your account is not linked yet. Please wait for admin approval and linking.",
      });
    }

    await supabaseAdmin.rpc("refresh_driver_subscription", { did: mapping.driver_id });

    const { data: driver, error: driverErr } = await supabaseAdmin
      .from("drivers")
      .select(
        "id,first_name,last_name,phone,status,online,busy,subscription_status,subscription_expires_at,subscription_plan,lat,lng,last_seen,profile_completed,verification_status,vehicle_make,vehicle_model,vehicle_registration,vehicle_color,vehicle_year"
      )
      .eq("id", mapping.driver_id)
      .maybeSingle();

    if (driverErr) {
      return NextResponse.json({ ok: false, error: driverErr.message }, { status: 500 });
    }

    if (!driver) {
      return NextResponse.json({
        ok: false,
        code: "DRIVER_MISSING",
        error: "Driver record not found for your account mapping.",
      });
    }

    // Do not force drivers offline from a profile read. Commission drivers have no
    // subscription, and this read runs on every app resume, which knocked them offline.
    // Eligibility (commission lock, account status) is enforced at go-online and dispatch.

    return NextResponse.json({ ok: true, driver });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
