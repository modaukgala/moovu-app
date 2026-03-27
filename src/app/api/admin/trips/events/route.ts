import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { searchParams } = new URL(req.url);
    const tripId = String(searchParams.get("tripId") ?? "").trim();

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID is required." },
        { status: 400 }
      );
    }

    const { supabaseAdmin } = auth;

    const { data, error } = await supabaseAdmin
      .from("trip_events")
      .select(`
        id,
        trip_id,
        event_type,
        message,
        old_status,
        new_status,
        created_at,
        created_by
      `)
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      events: data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load trip timeline." },
      { status: 500 }
    );
  }
}