import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import {
  calculateCustomerCancellationFee,
  isWithinFreeCancellationWindow,
} from "@/lib/finance/cancellationFees";
import { notifyAdmins, notifyDriverForTrip } from "@/lib/push-notify";
import { sendPushSafe } from "@/lib/push-server";
import { applyCancellationCreditServer } from "@/lib/finance/driverWalletLedger";

const VALID_REASONS = [
  "Booked by mistake",
  "Testing the app",
  "Changed my mind",
  "Wrong pickup or destination",
  "Driver taking too long",
  "Found another ride",
  "Emergency",
  "Other",
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isMissingCancellationColumn(error: { message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return (
    message.includes("cancellation_") ||
    message.includes("cancelled_at") ||
    message.includes("cancelled_within_free_window")
  );
}

function isMissingOfferTable(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return error?.code === "PGRST205" || message.includes("driver_trip_offers");
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
    const reasonDetails = String(body?.reasonDetails ?? "").trim().slice(0, 240);

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
    if (reason === "Other" && reasonDetails.length < 3) {
      return NextResponse.json(
        { ok: false, error: "Please briefly explain why you are cancelling." },
        { status: 400 },
      );
    }

    const { data: trip, error: tripError } = await auth.supabaseAdmin
      .from("trips")
      .select("id,status,customer_id,driver_id,created_at,ride_option")
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

    const cancellationNowMs = Date.now();
    const fee = calculateCustomerCancellationFee({
      status: trip.status,
      createdAt: trip.created_at,
      rideOptionId: trip.ride_option,
      nowMs: cancellationNowMs,
    });
    const cancelledAt = new Date().toISOString();
    const cancelledWithinFreeWindow = isWithinFreeCancellationWindow(trip.created_at, cancellationNowMs);
    const { data: activeOffers, error: activeOffersError } = await auth.supabaseAdmin
      .from("driver_trip_offers")
      .select("id,driver_id")
      .eq("trip_id", tripId)
      .in("status", ["pending", "shown"]);

    if (activeOffersError && !isMissingOfferTable(activeOffersError)) {
      console.error("[cancel-trip] active offer lookup failed", {
        tripId,
        reason: activeOffersError.message,
      });
    }

    const { data: updatedTrip, error: updateError } = await auth.supabaseAdmin
      .from("trips")
      .update({
        status: "cancelled",
        cancel_reason: reason,
        cancellation_reason: reason,
        cancellation_reason_details: reason === "Other" ? reasonDetails : null,
        cancellation_status_at_request: trip.status,
        cancelled_within_free_window: cancelledWithinFreeWindow,
        cancellation_type: fee.type,
        cancelled_by: "customer",
        cancelled_at: cancelledAt,
        cancellation_fee_amount: fee.feeAmount,
        cancellation_driver_amount: fee.driverAmount,
        cancellation_moovu_amount: fee.moovuAmount,
        cancellation_policy_code: fee.policyCode,
      })
      .eq("id", tripId)
      .eq("status", trip.status)
      .select("id")
      .maybeSingle();

    let tripUpdated = Boolean(updatedTrip);

    if (updateError && isMissingCancellationColumn(updateError)) {
      const { data: legacyUpdatedTrip, error: legacyUpdateError } = await auth.supabaseAdmin
        .from("trips")
        .update({
          status: "cancelled",
          cancel_reason: reason,
          cancelled_by: "customer",
          cancellation_fee_amount: fee.feeAmount,
          cancellation_policy_code: fee.policyCode,
        })
        .eq("id", tripId)
        .eq("status", trip.status)
        .select("id")
        .maybeSingle();

      if (legacyUpdateError) {
        console.error("[cancel-trip] legacy trip update failed", {
          tripId,
          reason: legacyUpdateError.message,
        });
        return NextResponse.json(
          { ok: false, error: "We could not cancel this trip. Please refresh and try again." },
          { status: 500 }
        );
      }
      tripUpdated = Boolean(legacyUpdatedTrip);
    } else if (updateError) {
      console.error("[cancel-trip] trip update failed", { tripId, reason: updateError.message });
      return NextResponse.json(
        { ok: false, error: "We could not cancel this trip. Please refresh and try again." },
        { status: 500 }
      );
    }
    if (!tripUpdated) {
      return NextResponse.json(
        { ok: false, error: "This trip changed while you were cancelling. Please refresh and try again." },
        { status: 409 },
      );
    }

    if (activeOffers && activeOffers.length > 0) {
      const { error: offerCancelError } = await auth.supabaseAdmin
        .from("driver_trip_offers")
        .update({
          status: "cancelled",
          cancelled_at: cancelledAt,
          responded_at: cancelledAt,
          updated_at: cancelledAt,
        })
        .eq("trip_id", tripId)
        .in("status", ["pending", "shown"]);

      if (offerCancelError && !isMissingOfferTable(offerCancelError)) {
        console.error("[cancel-trip] offer cleanup failed", {
          tripId,
          reason: offerCancelError.message,
        });
      }
    }

    const feeAudit = await recordCancellationFee({
      supabaseAdmin: auth.supabaseAdmin,
      tripId,
      customerId: auth.customer.id,
      driverId: trip.driver_id,
      feeType: fee.type,
      feeAmount: fee.feeAmount,
      driverAmount: fee.driverAmount,
      moovuAmount: fee.moovuAmount,
      reason: reason === "Other" ? `${reason}: ${reasonDetails}` : reason,
      createdBy: auth.user.id,
    });

    if (!feeAudit.ok) {
      console.error("[cancel-trip] fee audit insert failed after cancellation", {
        tripId,
        customerId: auth.customer.id,
        reason: feeAudit.error,
      });
    }

    let cancellationCreditWarning: string | null = null;
    if (trip.driver_id && fee.driverAmount > 0) {
      const creditResult = await applyCancellationCreditServer({
        tripId,
        driverId: trip.driver_id,
        amount: fee.driverAmount,
        description: `Customer cancellation payout for trip ${tripId}`,
      });
      if (!creditResult.ok) {
        cancellationCreditWarning = creditResult.error;
        console.error("[cancel-trip] driver cancellation credit failed", {
          tripId,
          driverId: trip.driver_id,
          reason: creditResult.error,
        });
      }
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

    const offeredDriverIds = Array.from(
      new Set((activeOffers ?? []).map((offer) => String(offer.driver_id)).filter(Boolean)),
    ).filter((driverId) => driverId !== trip.driver_id);

    if (offeredDriverIds.length > 0) {
      const { data: offeredAccounts, error: accountError } = await auth.supabaseAdmin
        .from("driver_accounts")
        .select("user_id")
        .in("driver_id", offeredDriverIds);

      if (accountError) {
        console.error("[cancel-trip] offered driver notification lookup failed", {
          tripId,
          reason: accountError.message,
        });
      } else {
        const userIds = Array.from(
          new Set((offeredAccounts ?? []).map((account) => String(account.user_id)).filter(Boolean)),
        );
        if (userIds.length > 0) {
          await sendPushSafe({
            userIds,
            role: "driver",
            title: "Trip cancelled",
            body: "This trip is no longer available because the customer cancelled it.",
            url: "/driver",
            data: { type: "trip_cancelled", tripId },
          });
        }
      }
    }

    await notifyAdmins(
      "Trip cancelled by customer",
      fee.feeAmount > 0
        ? `Trip ${tripId} was cancelled by the customer. Fee applied: R${fee.feeAmount}.`
        : `Trip ${tripId} was cancelled by the customer.`,
      "/admin/trips"
    );

    await sendPushSafe({
      userIds: [auth.user.id],
      role: "customer",
      title: "Trip cancelled",
      body: fee.feeAmount > 0
        ? `Your trip was cancelled. A fee of R${fee.feeAmount.toFixed(2)} was applied.`
        : "Your trip was cancelled successfully.",
      url: `/ride/${tripId}`,
      data: { type: "trip_cancelled", tripId },
    });

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
      cancellationAuditWarning:
        feeAudit.ok && "warning" in feeAudit
          ? feeAudit.warning
          : feeAudit.ok
            ? null
            : "Fee audit could not be recorded.",
      cancellationCreditWarning,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error") },
      { status: 500 }
    );
  }
}
