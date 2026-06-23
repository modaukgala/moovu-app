import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";

const ACTIVE_TRIP_STATUSES = ["requested", "offered", "assigned", "arrived", "ongoing"];

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
  const auth = await getAuthenticatedCustomer(req);

  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const now = new Date().toISOString();

  const { data: activeTrips, error: activeTripError } = await auth.supabaseAdmin
    .from("trips")
    .select("id,status")
    .eq("customer_id", auth.customer.id)
    .in("status", ACTIVE_TRIP_STATUSES)
    .limit(1);

  if (activeTripError) {
    return NextResponse.json(
      { ok: false, error: "We could not check your active rides. Please try again." },
      { status: 500 },
    );
  }

  if ((activeTrips ?? []).length > 0) {
    return NextResponse.json(
      { ok: false, error: "Please complete or cancel your active ride before requesting account deletion." },
      { status: 409 },
    );
  }

  const requestRow = {
    user_id: auth.user.id,
    role: "customer",
    customer_id: auth.customer.id,
    driver_id: null,
    status: "pending",
    reason: reason || null,
    requested_at: now,
    updated_at: now,
  };

  const { data: request, error: requestError } = await auth.supabaseAdmin
    .from("account_deletion_requests")
    .upsert(requestRow, {
      onConflict: "user_id,role,status",
    })
    .select("id,status,requested_at")
    .single();

  if (requestError) {
    console.error("[account-deletion] customer request insert failed", {
      userId: auth.user.id,
      customerId: auth.customer.id,
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

  const { error: customerUpdateError } = await auth.supabaseAdmin
    .from("customers")
    .update({
      deletion_requested_at: now,
      deletion_status: "pending",
      deletion_reason: reason || null,
      updated_at: now,
    })
    .eq("id", auth.customer.id);

  if (customerUpdateError && !isMissingSchema(customerUpdateError)) {
    console.error("[account-deletion] customer status update failed", {
      userId: auth.user.id,
      customerId: auth.customer.id,
      error: customerUpdateError.message,
    });
  }

  return NextResponse.json({
    ok: true,
    request,
    message: "Your MOOVU account deletion request was submitted. MOOVU will review required records before final removal.",
  });
}
