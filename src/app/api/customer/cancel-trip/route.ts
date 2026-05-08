import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { calculateCustomerCancellationFee } from "@/lib/finance/cancellationFees";
import { notifyAdmins, notifyDriverForTrip } from "@/lib/push-notify";

const VALID_REASONS = [
  "Driver is taking too long",
  "Booked by mistake",
  "Changed my plans",
  "Found another ride",
  "Pickup location issue",
  "Other",
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isMissingCancellationColumn(error: { message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return message.includes("cancellation_") || message.includes("cancelled_at");
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
      .select("id,status,customer_id,driver_id,created_at")
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

    const fee = calculateCustomerCancellationFee({
      status: trip.status,
      createdAt: trip.created_at,
    });
    const cancelledAt = new Date().toISOString();

    if (fee.feeAmount > 0) {
      const { error: feeInsertError } = await auth.supabaseAdmin
        .from("trip_cancellation_fees")
        .insert({
          trip_id: tripId,
          customer_id: auth.customer.id,
          driver_id: trip.driver_id,
          fee_type: fee.type,
          fee_amount: fee.feeAmount,
          driver_amount: fee.driverAmount,
          moovu_amount: fee.moovuAmount,
          reason,
          created_by: auth.user.id,
        });

      if (feeInsertError) {
        console.error("[cancel-trip] paid fee insert failed", {
          tripId,
          customerId: auth.customer.id,
          reason: feeInsertError.message,
        });
        return NextResponse.json(
          { ok: false, error: "Cancellation fee could not be recorded. Please try again or contact support." },
          { status: 500 }
        );
      }
    }

    const { error: updateError } = await auth.supabaseAdmin
      .from("trips")
      .update({
        status: "cancelled",
        cancel_reason: reason,
        cancellation_reason: reason,
        cancellation_type: fee.type,
        cancelled_by: "customer",
        cancelled_at: cancelledAt,
        cancellation_fee_amount: fee.feeAmount,
        cancellation_driver_amount: fee.driverAmount,
        cancellation_moovu_amount: fee.moovuAmount,
        cancellation_policy_code: fee.policyCode,
      })
      .eq("id", tripId);

    if (updateError && isMissingCancellationColumn(updateError)) {
      const { error: legacyUpdateError } = await auth.supabaseAdmin
        .from("trips")
        .update({
          status: "cancelled",
          cancel_reason: reason,
          cancelled_by: "customer",
          cancellation_fee_amount: fee.feeAmount,
          cancellation_policy_code: fee.policyCode,
        })
        .eq("id", tripId);

      if (legacyUpdateError) {
        return NextResponse.json(
          { ok: false, error: legacyUpdateError.message },
          { status: 500 }
        );
      }
    } else if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      );
    }

    if (trip.driver_id) {
      await auth.supabaseAdmin
        .from("drivers")
        .update({ busy: false })
        .eq("id", trip.driver_id);
    }

    if (fee.feeAmount === 0) {
      const { error: freeFeeInsertError } = await auth.supabaseAdmin
        .from("trip_cancellation_fees")
        .insert({
          trip_id: tripId,
          customer_id: auth.customer.id,
          driver_id: trip.driver_id,
          fee_type: fee.type,
          fee_amount: fee.feeAmount,
          driver_amount: fee.driverAmount,
          moovu_amount: fee.moovuAmount,
          reason,
          created_by: auth.user.id,
        });

      if (freeFeeInsertError) {
        console.error("[cancel-trip] free cancellation audit insert failed", {
          tripId,
          customerId: auth.customer.id,
          reason: freeFeeInsertError.message,
        });
      }
    }

    const { error: eventError } = await auth.supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "trip_cancelled",
        message:
          fee.feeAmount > 0
            ? `Trip cancelled by customer. Reason: ${reason}. Cancellation fee applied: R${fee.feeAmount}. Driver payout: R${fee.driverAmount}. MOOVU revenue: R${fee.moovuAmount}.`
            : `Trip cancelled by customer. Reason: ${reason}.`,
        old_status: trip.status,
        new_status: "cancelled",
      });

    if (eventError) {
      console.error("[cancel-trip] event insert failed", {
        tripId,
        reason: eventError.message,
      });
    }

    await notifyDriverForTrip(
      tripId,
      "Trip cancelled",
      fee.feeAmount > 0
        ? `The customer cancelled the trip. Your cancellation payout is R${fee.driverAmount}.`
        : "The customer cancelled the trip.",
      "/driver"
    );

    await notifyAdmins(
      "Trip cancelled by customer",
      fee.feeAmount > 0
        ? `Trip ${tripId} was cancelled by the customer. Fee applied: R${fee.feeAmount}.`
        : `Trip ${tripId} was cancelled by the customer.`,
      "/admin/trips"
    );

    return NextResponse.json({
      ok: true,
      message:
        fee.feeAmount > 0
          ? `Trip cancelled. A cancellation fee of R${fee.feeAmount.toFixed(2)} was applied.`
          : "Trip cancelled successfully.",
      cancellationFeeAmount: fee.feeAmount,
      cancellationDriverAmount: fee.driverAmount,
      cancellationMoovuAmount: fee.moovuAmount,
      cancellationPolicyCode: fee.policyCode,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error") },
      { status: 500 }
    );
  }
}
