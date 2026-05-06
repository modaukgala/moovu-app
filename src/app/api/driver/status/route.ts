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

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }

    const { online } = await req.json();
    const wantOnline = !!online;

    const { data: mapping, error: mErr } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .single();

    if (mErr) {
      return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
    }

    const driverId = mapping?.driver_id ?? null;
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Not linked" }, { status: 403 });
    }

    await supabaseAdmin.rpc("refresh_driver_subscription", { did: driverId });

    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id,status,subscription_status,profile_completed")
      .eq("id", driverId)
      .single();

    if (dErr || !driver) {
      return NextResponse.json({ ok: false, error: "Driver not found" }, { status: 404 });
    }

    if (wantOnline) {
      if (!driver.profile_completed) {
        return NextResponse.json(
          { ok: false, error: "Complete your profile before going online." },
          { status: 403 }
        );
      }

      if (driver.status !== "approved" && driver.status !== "active") {
        return NextResponse.json(
          { ok: false, error: "Driver not approved" },
          { status: 403 }
        );
      }

      if (driver.subscription_status !== "active" && driver.subscription_status !== "grace") {
        return NextResponse.json(
          { ok: false, error: "Subscription inactive" },
          { status: 402 }
        );
      }
    }

    const { error: upErr } = await supabaseAdmin
      .from("drivers")
      .update({
        online: wantOnline,
        last_seen: new Date().toISOString(),
      })
      .eq("id", driverId);

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, online: wantOnline });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
