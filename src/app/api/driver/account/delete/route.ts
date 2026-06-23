import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDriverIdForUser, getUserFromBearer } from "@/app/api/driver/utils";

const ACTIVE_TRIP_STATUSES = ["assigned", "arrived", "ongoing"];

function isMissingSchema(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return (
    error?.code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("relation") && message.includes("does not exist") ||
    message.includes("column") && message.includes("does not exist")
  );
}

export async function POST(req: Request) {
  const user = await getUserFromBearer(req);

  if (!user) {
    return NextResponse.json({ ok: false, error: "Not logged in." }, { status: 401 });
  }

  const driverId = await getDriverIdForUser(user.id);
  if (!driverId) {
    return NextResponse.json({ ok: false, error: "Driver account is not linked." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const now = new Date().toISOString();

  const { data: activeTrips, error: activeTripError } = await supabaseAdmin
    .from("trips")
    .select("id,status")
    .eq("driver_id", driverId)
    .in("status", ACTIVE_TRIP_STATUSES)
    .limit(1);

  if (activeTripError) {
    return NextResponse.json(
      { ok: false, error: "We could not check your active trips. Please try again." },
      { status: 500 },
    );
  }

  if ((activeTrips ?? []).length > 0) {
    return NextResponse.json(
      { ok: false, error: "Please complete your active trip before requesting account deletion." },
      { status: 409 },
    );
  }

  const requestRow = {
    user_id: user.id,
    role: "driver",
    customer_id: null,
    driver_id: driverId,
    status: "pending",
    reason: reason || null,
    requested_at: now,
    updated_at: now,
  };

  const { data: request, error: requestError } = await supabaseAdmin
    .from("account_deletion_requests")
    .upsert(requestRow, {
      onConflict: "user_id,role,status",
    })
    .select("id,status,requested_at")
    .single();

  if (requestError) {
    console.error("[account-deletion] driver request insert failed", {
      userId: user.id,
      driverId,
      error: requestError.message,
    });

    if (isMissingSchema(requestError)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Account deletion setup is not complete yet. Please contact MOOVU support.",
          migrationRequired: "docs/account-deletion-migration.sql",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { ok: false, error: "We could not submit your deletion request. Please try again." },
      { status: 500 },
    );
  }

  const { error: driverUpdateError } = await supabaseAdmin
    .from("drivers")
    .update({
      deletion_requested_at: now,
      deletion_status: "pending",
      deletion_reason: reason || null,
      online: false,
      updated_at: now,
    })
    .eq("id", driverId);

  if (driverUpdateError && !isMissingSchema(driverUpdateError)) {
    console.error("[account-deletion] driver status update failed", {
      userId: user.id,
      driverId,
      error: driverUpdateError.message,
    });
  }

  return NextResponse.json({
    ok: true,
    request,
    message: "Your MOOVU Driver account deletion request was submitted. MOOVU will review required trip, payment, and safety records before final removal.",
  });
}
