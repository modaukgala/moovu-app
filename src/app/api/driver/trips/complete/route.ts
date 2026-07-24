import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { completeTripServer } from "@/lib/trips/completeTripServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 401 });
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: authData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !authData.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (accountError || !account?.driver_id) {
      return NextResponse.json({ ok: false, error: "Driver account is not linked." }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      tripId?: unknown;
      otp?: unknown;
      completionMode?: unknown;
      bypassReason?: unknown;
      bypassNote?: unknown;
    };
    const tripId = String(body.tripId ?? "").trim();
    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    }

    const mode = body.completionMode === "bypass" ? "bypass" : "otp";
    const result = await completeTripServer({
      tripId,
      actorId: authData.user.id,
      driverId: account.driver_id,
      mode,
      otp: String(body.otp ?? "").trim(),
      reason: String(body.bypassReason ?? "").trim(),
      note: String(body.bypassNote ?? "").trim(),
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("[driver-complete] failed", error);
    return NextResponse.json(
      { ok: false, error: "We could not complete this trip. Please try again." },
      { status: 500 },
    );
  }
}
