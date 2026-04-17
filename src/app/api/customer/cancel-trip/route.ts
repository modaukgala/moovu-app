import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { notifyAdmins, notifyDriverForTrip } from "@/lib/push-notify";

const VALID_REASONS = [
  "Driver is taking too long",
  "Booked by mistake",
  "Changed my plans",
  "Found another ride",
  "Pickup location issue",
  "Other",
];

function computeCancellationFee(status: string) {
  if (status === "requested" || status === "offered") {
    return { fee: 0, code: "free_window" };
  }

  if (status === "assigned") {
    return { fee: 10, code: "driver_dispatched" };
  }

  if (status === "arrived") {
    return { fee: 20, code: "driver_arrived" };
  }

  return { fee: 0, code: "standard" };
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthenticatedCustomer(req);

    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json();

    const tripId = String(body?.tripId ?? "").trim();
    const reason = String(body?.reason ?? "").trim();

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID is required." },
        { status: 400 }
      );
    }

    if (!VALID_REASONS.includes(reason)) {
      return NextResponse.json(
        { ok: false, error: "Please select a valid cancellation reason." },
        { status: 400 }
      );
    }

    const { data: trip, error: tripError } = await auth.supabaseAdmin
      .from("trips")
      .select("id,status,customer_id")
      .eq("id", tripId)
      .eq("customer_id", auth.customer.id)
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

    if (trip.status === "completed") {
      return NextResponse.json(
        { ok: false, error: "Completed trips cannot be cancelled." },
        { status: 400 }
      );
    }

    if (trip.status === "ongoing") {
      return NextResponse.json(
        { ok: false, error: "Trips already in progress cannot be cancelled here." },
        { status: 400 }
      );
    }

    if (trip.status === "cancelled") {
      return NextResponse.json(
        { ok: false, error: "Trip is already cancelled." },
        { status: 400 }
      );
    }

    const { fee, code } = computeCancellationFee(trip.status);

    const { error: updateError } = await auth.supabaseAdmin
      .from("trips")
      .update({
        status: "cancelled",
        cancel_reason: reason,
        cancelled_by: "customer",
        cancellation_fee_amount: fee,
        cancellation_policy_code: code,
      })
      .eq("id", tripId);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      );
    }

    try {
      await auth.supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "trip_cancelled",
        message:
          fee > 0
            ? `Trip cancelled by customer. Reason: ${reason}. Cancellation fee applied: R${fee}.`
            : `Trip cancelled by customer. Reason: ${reason}.`,
        old_status: trip.status,
        new_status: "cancelled",
      });
    } catch {}

    await notifyDriverForTrip(
      tripId,
      "Trip cancelled",
      fee > 0
        ? `The customer cancelled the trip. Cancellation fee applied: R${fee}.`
        : "The customer cancelled the trip.",
      "/driver"
    );

    await notifyAdmins(
      "Trip cancelled by customer",
      fee > 0
        ? `Trip ${tripId} was cancelled by the customer. Fee applied: R${fee}.`
        : `Trip ${tripId} was cancelled by the customer.`,
      "/admin/trips"
    );

    return NextResponse.json({
      ok: true,
      message:
        fee > 0
          ? `Trip cancelled. A cancellation fee of R${fee.toFixed(2)} was applied.`
          : "Trip cancelled successfully.",
      cancellationFeeAmount: fee,
      cancellationPolicyCode: code,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}