import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { notifyAdmins, notifyDriverForTrip } from "@/lib/push-notify";
import { sendPushSafe } from "@/lib/push-server";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";
import { isOutboxDeliveryEnabled } from "@/lib/notifications/outboxDelivery";
import { phase4AuthorityForTrip } from "@/lib/finance/phase4AuthorityServer";
import { callPhase4Rpc } from "@/lib/server/phase4Rpc";

const VALID_REASONS = [
  "Booked by mistake", "Testing the app", "Changed my mind", "Wrong pickup or destination",
  "Driver taking too long", "Found another ride", "Emergency", "Other",
];
type CancellationResult = {
  trip_id: string;
  driver_id: string | null;
  fee_amount: number;
  driver_amount: number;
  moovu_amount: number;
  policy_code: string;
  offered_driver_ids?: string[];
  replayed: boolean;
};

export async function POST(req: Request) {
  try {
    const auth = await getAuthenticatedCustomer(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => null);
    const tripId = String(body?.tripId ?? "").trim();
    const reason = String(body?.reason ?? "").trim();
    const reasonDetails = String(body?.reasonDetails ?? "").trim().slice(0, 240);
    if (!tripId) return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    if (!VALID_REASONS.includes(reason)) {
      return NextResponse.json({ ok: false, error: "Please select a valid cancellation reason." }, { status: 400 });
    }
    if (reason === "Other" && reasonDetails.length < 3) {
      return NextResponse.json({ ok: false, error: "Please briefly explain why you are cancelling." }, { status: 400 });
    }

    const authority = await phase4AuthorityForTrip(auth.supabaseAdmin, tripId);
    if (!authority) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    if (authority === "PHASE4") {
      const quoteId = String(body?.quoteId ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(quoteId)) {
        return NextResponse.json({ ok: false, error: "Confirm an authoritative cancellation quote first." }, { status: 409 });
      }
      const result = await callPhase4Rpc<{
        trip_id: string; replayed: boolean; requires_reconfirmation?: boolean;
        fee_cents?: number; driver_cents?: number; moovu_cents?: number;
      }>(auth.supabaseAdmin, "phase4b_cancel_customer_trip", {
        p_trip_id: tripId, p_customer_id: auth.customer.id, p_actor_id: auth.user.id,
        p_quote_id: quoteId, p_reason: reason,
        p_reason_details: reason === "Other" ? reasonDetails : null,
      }, (value) => value.requires_reconfirmation === true || typeof value.replayed === "boolean");
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
      if (result.result.requires_reconfirmation) {
        return NextResponse.json({ ok: false, requiresReconfirmation: true,
          error: "Cancellation terms changed. Review a fresh quote before confirming." }, { status: 409 });
      }
      const feeCents = Number(result.result.fee_cents ?? 0);
      return NextResponse.json({ ok: true, authority, replayed: result.result.replayed,
        message: result.result.replayed ? "This cancellation was already recorded."
          : feeCents > 0 ? `Trip cancelled. R${(feeCents / 100).toFixed(2)} is owed.` : "Trip cancelled successfully.",
        cancellationFeeAmount: feeCents / 100,
        cancellationDriverAmount: Number(result.result.driver_cents ?? 0) / 100,
        cancellationMoovuAmount: Number(result.result.moovu_cents ?? 0) / 100 });
    }

    const cancellation = await callHardenedRpc<CancellationResult>(auth.supabaseAdmin, "phase05b_cancel_trip", {
      p_trip_id: tripId,
      p_customer_id: auth.customer.id,
      p_actor_id: auth.user.id,
      p_reason: reason,
      p_reason_details: reason === "Other" ? reasonDetails : null,
    });
    if (!cancellation.ok) {
      return NextResponse.json({ ok: false, error: cancellation.error, code: cancellation.code }, { status: cancellation.status });
    }
    const outcome = cancellation.result;
    if (!outcome.replayed && !isOutboxDeliveryEnabled()) {
      const sends: Promise<unknown>[] = [
        notifyAdmins(
          "Trip cancelled by customer",
          outcome.fee_amount > 0 ? `Trip ${tripId} was cancelled. Fee assessed: R${outcome.fee_amount}.` : `Trip ${tripId} was cancelled.`,
          "/admin/trips",
        ),
        sendPushSafe({
          userIds: [auth.user.id], role: "customer", title: "Trip cancelled",
          body: outcome.fee_amount > 0 ? `Your trip was cancelled. A fee of R${outcome.fee_amount.toFixed(2)} was assessed.` : "Your trip was cancelled successfully.",
          url: `/ride/${tripId}`, data: { type: "trip_cancelled", tripId },
        }),
      ];
      if (outcome.driver_id) {
        sends.push(notifyDriverForTrip(
          tripId, "Trip cancelled",
          outcome.driver_amount > 0
            ? `The customer cancelled. An R${outcome.driver_amount} commission offset was recorded under the existing policy.`
            : "The customer cancelled the trip.",
          "/driver",
        ));
      }
      const offered = Array.from(new Set(outcome.offered_driver_ids ?? [])).filter((id) => id !== outcome.driver_id);
      if (offered.length) {
        const { data: accounts } = await auth.supabaseAdmin.from("driver_accounts").select("user_id").in("driver_id", offered);
        const userIds = Array.from(new Set((accounts ?? []).map((row) => String(row.user_id)).filter(Boolean)));
        if (userIds.length) sends.push(sendPushSafe({
          userIds, role: "driver", title: "Trip cancelled",
          body: "This trip is no longer available because the customer cancelled it.",
          url: "/driver", data: { type: "trip_cancelled", tripId },
        }));
      }
      await Promise.all(sends.map((send) => Promise.resolve(send).catch(() => null)));
    }
    return NextResponse.json({
      ok: true,
      replayed: outcome.replayed,
      message: outcome.replayed
        ? "This cancellation was already recorded."
        : outcome.fee_amount > 0 ? `Trip cancelled. A fee of R${outcome.fee_amount.toFixed(2)} was assessed.` : "Trip cancelled successfully.",
      cancellationFeeAmount: outcome.fee_amount,
      cancellationDriverAmount: outcome.driver_amount,
      cancellationMoovuAmount: outcome.moovu_amount,
      cancellationPolicyCode: outcome.policy_code,
    });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error." }, { status: 500 });
  }
}
