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

    const { data: driver, error: driverErr } = await supabaseAdmin
      .from("drivers")
      .select(
        "id,first_name,last_name,phone,status,online,busy,subscription_status,subscription_expires_at,subscription_plan,lat,lng,last_seen,profile_completed,verification_status"
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

    return NextResponse.json({ ok: true, driver });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}