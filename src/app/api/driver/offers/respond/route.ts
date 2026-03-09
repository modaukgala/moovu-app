import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { offerNextEligibleDriver } from "@/lib/trip-offers";

async function getUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  // @ts-ignore
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in (missing/invalid token)" }, { status: 401 });
    }

    const { tripId, action } = await req.json();

    if (!tripId || !action) {
      return NextResponse.json({ ok: false, error: "Missing tripId/action" }, { status: 400 });
    }
    if (action !== "accept" && action !== "reject") {
      return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
    }

    const { data: mapping, error: mErr } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .single();

    if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });

    const driverId = mapping?.driver_id ?? null;
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Not linked (admin must link your account to a driver)" }, { status: 403 });
    }

    const { data: trip, error: tErr } = await supabaseAdmin
      .from("trips")
      .select("id,driver_id,status,offer_status,offer_expires_at,offer_attempted_driver_ids")
      .eq("id", tripId)
      .single();

    if (tErr || !trip) {
      return NextResponse.json({ ok: false, error: tErr?.message ?? "Trip not found" }, { status: 404 });
    }

    if (trip.driver_id !== driverId || trip.offer_status !== "pending" || trip.status !== "offered") {
      return NextResponse.json({ ok: false, error: "No pending offer for your account" }, { status: 400 });
    }

    if (trip.offer_expires_at && Date.now() > new Date(trip.offer_expires_at).getTime()) {
      await supabaseAdmin.from("drivers").update({ busy: false }).eq("id", driverId);

      await supabaseAdmin
        .from("trips")
        .update({
          driver_id: null,
          status: "requested",
          offer_status: "expired",
          offer_expires_at: null,
          offer_attempted_driver_ids: Array.from(
            new Set([...(trip.offer_attempted_driver_ids ?? []), driverId])
          ),
        })
        .eq("id", tripId);

      await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "offer_expired",
        message: "Offer expired (late response)",
        old_status: "offered",
        new_status: "requested",
      });

      // Auto re-offer next driver
      const next = await offerNextEligibleDriver(tripId, [driverId]);

      if (!next.ok) {
        return NextResponse.json({
          ok: false,
          error: "Offer expired. No next eligible driver available.",
        }, { status: 400 });
      }

      return NextResponse.json({
        ok: true,
        status: "offered",
        nextDriverId: next.driverId,
        reoffered: true,
      });
    }

    if (action === "accept") {
      await supabaseAdmin
        .from("trips")
        .update({ status: "assigned", offer_status: "accepted", offer_expires_at: null })
        .eq("id", tripId);

      await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "offer_accepted",
        message: "Driver accepted",
        old_status: "offered",
        new_status: "assigned",
      });

      return NextResponse.json({ ok: true, status: "assigned" });
    }

    // reject → free current driver, mark attempted, then auto-offer next
    await supabaseAdmin.from("drivers").update({ busy: false }).eq("id", driverId);

    await supabaseAdmin
      .from("trips")
      .update({
        driver_id: null,
        status: "requested",
        offer_status: "rejected",
        offer_expires_at: null,
        offer_attempted_driver_ids: Array.from(
          new Set([...(trip.offer_attempted_driver_ids ?? []), driverId])
        ),
      })
      .eq("id", tripId);

    await supabaseAdmin.from("trip_events").insert({
      trip_id: tripId,
      event_type: "offer_rejected",
      message: "Driver rejected",
      old_status: "offered",
      new_status: "requested",
    });

    const next = await offerNextEligibleDriver(tripId, [driverId]);

    if (!next.ok) {
      return NextResponse.json({
        ok: true,
        status: "requested",
        reoffered: false,
        message: "Rejected. No next eligible driver available.",
      });
    }

    return NextResponse.json({
      ok: true,
      status: "offered",
      reoffered: true,
      nextDriverId: next.driverId,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}