import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const driverId = String(url.searchParams.get("driverId") ?? "").trim();
    if (!driverId) return NextResponse.json({ ok: false, error: "Missing driverId" }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("driver_subscription_events")
      .select("id,action,old_status,new_status,old_expires_at,new_expires_at,note,created_at,actor")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, events: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}