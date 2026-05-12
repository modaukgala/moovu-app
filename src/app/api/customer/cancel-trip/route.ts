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

function isMissingCancellationFeeTable(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return (
    error?.code === "PGRST205" ||
    message.includes("trip_cancellation_fees") ||
    (message.includes("could not find the table") && message.includes("cancellation"))
  );
}

async function recordCancellationFee(params: {
  supabaseAdmin: typeof import("@/lib/supabase/admin").supabaseAdmin;
  tripId: string;
  customerId: string;
  driverId: string | null;
  feeType: string;
  feeAmount: number;
  driverAmount: number;
  moovuAmount: number;
  reason: string;
  createdBy: string;
}) {
  const { data: existing, error: lookupError } = await params.supabaseAdmin
    .from("trip_cancellation_fees")
    .select("id")
    .eq("trip_id", params.tripId)
    .limit(1);

  if (lookupError) {
    if (isMissingCancellationFeeTable(lookupError)) {
      console.error("[cancel-trip] trip_cancellation_fees table missing. Run docs/cancellation-management-migration.sql.", {
        tripId: params.tripId,
        reason: lookupError.message,
      });
      return { ok: true, skipped: true, warning: "Cancellation fee audit table is missing." };
    }

    return { ok: false, error: lookupError.message };
  }

  if (existing && existing.length > 0) {
    return { ok: true, skipped: true };
  }

  const { error: feeInsertError } = await params.supabaseAdmin
    .from("trip_cancellation_fees")
    .insert({
      trip_id: params.tripId,
      customer_id: params.customerId,
      driver_id: params.driverId,
      fee_type: params.feeType,
      fee_amount: params.feeAmount,
      driver_amount: params.driverAmount,
      moovu_amount: params.moovuAmount,
      reason: params.reason,
      created_by: params.createdBy,
    });

  if (feeInsertError) {
    if (isMissingCancellationFeeTable(feeInsertError)) {
      console.error("[cancel-trip] trip_cancellation_fees table missing. Run docs/cancellation-management-migration.sql.", {
        tripId: params.tripId,
        reason: feeInsertError.message,
      });
      return { ok: true, skipped: true, warning: "Cancellation fee audit table is missing." };
    }

    return { ok: false, error: feeInsertError.message };
  }

  return { ok: true, skipped: false };
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

    const feeAudit = await recordCancellationFee({
      supabaseAdmin: auth.supabaseAdmin,
      tripId,
      customerId: auth.customer.id,
      driverId: trip.driver_id,
      feeType: fee.type,
      feeAmount: fee.feeAmount,
      driverAmount: fee.driverAmount,
      moovuAmount: fee.moovuAmount,
      reason,
      createdBy: auth.user.id,
    });

    if (!feeAudit.ok) {
      console.error("[cancel-trip] fee audit insert failed", {
        tripId,
        customerId: auth.customer.id,
        reason: feeAudit.error,
      });
      return NextResponse.json(
        { ok: false, error: "Cancellation fee could not be recorded. Please try again or contact support." },
        { status: 500 }
      );
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
      cancellationAuditWarning: "warning" in feeAudit ? feeAudit.warning : null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error") },
      { status: 500 }
    );
  }
}
