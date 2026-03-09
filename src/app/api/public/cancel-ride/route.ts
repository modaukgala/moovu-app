import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const tripId = String(body.tripId ?? "").trim();
    const riderPhone = String(body.riderPhone ?? "").trim();
    const reason = String(body.reason ?? "Cancelled by rider").trim();

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Missing tripId" }, { status: 400 });
    }

    if (!riderPhone) {
      return NextResponse.json({ ok: false, error: "Missing rider phone" }, { status: 400 });
    }

    const { data: trip, error: tErr } = await supabaseAdmin
      .from("trips")
      .select("id,rider_phone,status,driver_id,cancel_reason")
      .eq("id", tripId)
      .single();

    if (tErr || !trip) {
      return NextResponse.json({ ok: false, error: tErr?.message ?? "Trip not found" }, { status: 404 });
    }

    if ((trip.rider_phone ?? "").trim() !== riderPhone) {
      return NextResponse.json({ ok: false, error: "Phone number does not match this trip" }, { status: 403 });
    }

    if (trip.status === "completed") {
      return NextResponse.json({ ok: false, error: "Completed trips cannot be cancelled" }, { status: 400 });
    }

    if (trip.status === "cancelled") {
      return NextResponse.json({ ok: true, alreadyCancelled: true });
    }

    await supabaseAdmin
      .from("trips")
      .update({
        status: "cancelled",
        cancel_reason: reason,
        offer_status: null,
        offer_expires_at: null,
      })
      .eq("id", tripId);

    if (trip.driver_id) {
      await supabaseAdmin.from("drivers").update({ busy: false }).eq("id", trip.driver_id);
    }

    await supabaseAdmin.from("trip_events").insert({
      trip_id: tripId,
      event_type: "rider_cancelled",
      message: reason,
      old_status: trip.status,
      new_status: "cancelled",
    });

    return NextResponse.json({ ok: true, status: "cancelled" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}