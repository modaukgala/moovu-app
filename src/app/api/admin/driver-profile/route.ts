import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  try {
    const driverId = req.nextUrl.searchParams.get("driverId");

    if (!driverId) {
      return NextResponse.json(
        { ok: false, error: "Missing driverId" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("driver_application_overview")
      .select("*")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, profile: data ?? null });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}