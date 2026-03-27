import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { applyTripCommissionServer } from "@/lib/finance/applyTripCommissionServer";

const ALLOWED_ADMIN_ROLES = ["owner", "admin", "dispatcher", "support"];

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing access token." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const tripId = String(body?.tripId ?? "").trim();

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID is required." },
        { status: 400 }
      );
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
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.role || !ALLOWED_ADMIN_ROLES.includes(profile.role)) {
      return NextResponse.json(
        { ok: false, error: "You are not allowed to complete trips." },
        { status: 403 }
      );
    }

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,status,driver_id,fare_amount,commission_amount")
      .eq("id", tripId)
      .maybeSingle();

    if (tripError) {
      return NextResponse.json(
        { ok: false, error: tripError.message },
        { status: 500 }
      );
    }

    if (!trip) {
      return NextResponse.json(
        { ok: false, error: "Trip not found." },
        { status: 404 }
      );
    }

    if (trip.status !== "ongoing") {
      return NextResponse.json(
        { ok: false, error: "Only ongoing trips can be completed." },
        { status: 400 }
      );
    }

    const fareAmount = Number(trip.fare_amount || 0);
    if (!Number.isFinite(fareAmount) || fareAmount <= 0) {
      return NextResponse.json(
        { ok: false, error: "Trip fare is missing or invalid." },
        { status: 400 }
      );
    }

    const { error: updateTripError } = await supabaseAdmin
      .from("trips")
      .update({
        status: "completed",
      })
      .eq("id", tripId);

    if (updateTripError) {
      return NextResponse.json(
        { ok: false, error: updateTripError.message },
        { status: 500 }
      );
    }

    let commissionResult:
      | Awaited<ReturnType<typeof applyTripCommissionServer>>
      | null = null;

    if (trip.driver_id) {
      commissionResult = await applyTripCommissionServer({
        tripId,
        driverId: trip.driver_id,
        fareAmount,
        createdBy: user.id,
        commissionPct: 5,
      });

      if (!commissionResult.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: `Trip was marked completed, but commission failed: ${commissionResult.error}`,
          },
          { status: 500 }
        );
      }

      await supabaseAdmin
        .from("drivers")
        .update({ busy: false })
        .eq("id", trip.driver_id);
    }

    try {
      await supabaseAdmin.from("trip_events").insert([
        {
          trip_id: tripId,
          event_type: "trip_completed_admin",
          message: "Trip completed by admin",
          old_status: "ongoing",
          new_status: "completed",
          created_by: user.id,
        },
        ...(commissionResult
          ? [
              {
                trip_id: tripId,
                event_type: "commission_applied",
                message: commissionResult.skipped
                  ? "Commission already existed for this trip"
                  : `Commission applied: R${commissionResult.calc.commissionAmount} | Driver net: R${commissionResult.calc.driverNet}`,
                old_status: "completed",
                new_status: "completed",
                created_by: user.id,
              },
            ]
          : []),
      ]);
    } catch {}

    return NextResponse.json({
      ok: true,
      message: "Trip completed successfully.",
      commission: commissionResult
        ? {
            skipped: commissionResult.skipped,
            fareAmount: commissionResult.calc.fareAmount,
            commissionPct: commissionResult.calc.commissionPct,
            commissionAmount: commissionResult.calc.commissionAmount,
            driverNet: commissionResult.calc.driverNet,
          }
        : null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}