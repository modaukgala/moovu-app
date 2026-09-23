import { createHash } from "crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyYocoWebhookSignature } from "@/lib/payments/yoco/webhook";
import { dispatchVerifiedOnlineTrip } from "@/lib/payments/yoco/dispatch";
import { normalizeYocoMode, yocoEventModeMatches } from "@/lib/payments/yoco/mode";

export const runtime = "nodejs";

type YocoPaymentEvent = {
  createdDate?: unknown;
  id?: unknown;
  type?: unknown;
  payload?: {
    amount?: unknown;
    currency?: unknown;
    id?: unknown;
    mode?: unknown;
    status?: unknown;
    type?: unknown;
    metadata?: {
      checkoutId?: unknown;
    } | null;
  } | null;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function POST(req: Request) {
  /*
   * IMPORTANT:
   * Yoco signs the exact raw request body.
   * Do not call req.json() before signature verification.
   */
  const rawBody = await req.text();

  const webhookId = req.headers.get("webhook-id")?.trim() ?? "";
  const webhookTimestamp = req.headers.get("webhook-timestamp")?.trim() ?? "";
  const webhookSignature = req.headers.get("webhook-signature")?.trim() ?? "";

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return NextResponse.json(
      { ok: false, error: "Missing webhook authentication." },
      { status: 400 },
    );
  }

  let signatureValid = false;

  try {
    signatureValid = verifyYocoWebhookSignature({
      rawBody,
      headers: {
        webhookId,
        webhookTimestamp,
        webhookSignature,
      },
    });
  } catch (error) {
    console.error(
      "[yoco-webhook] verification unavailable",
      error instanceof Error ? error.message : "Unknown error",
    );

    return NextResponse.json(
      { ok: false, error: "Webhook verification unavailable." },
      { status: 503 },
    );
  }

  if (!signatureValid) {
    return NextResponse.json(
      { ok: false, error: "Invalid webhook signature." },
      { status: 401 },
    );
  }

  let event: YocoPaymentEvent;

  try {
    event = JSON.parse(rawBody) as YocoPaymentEvent;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid webhook payload." },
      { status: 400 },
    );
  }

  const eventId = typeof event.id === "string" ? event.id.trim() : "";

  const eventType = typeof event.type === "string" ? event.type.trim() : "";

  if (!eventId || !eventType) {
    return NextResponse.json(
      { ok: false, error: "Invalid webhook event." },
      { status: 400 },
    );
  }

  /*
   * For now we only financially process payment.succeeded.
   *
   * Unsupported authenticated events are acknowledged so Yoco
   * does not repeatedly retry them. Refunds and failed-payment
   * finance will be handled separately.
   */
  if (eventType !== "payment.succeeded") {
    return NextResponse.json({
      ok: true,
      ignored: true,
      eventType,
    });
  }

  const payload = event.payload;

  const paymentId = typeof payload?.id === "string" ? payload.id.trim() : "";

  const checkoutId =
    typeof payload?.metadata?.checkoutId === "string"
      ? payload.metadata.checkoutId.trim()
      : "";

  const currency =
    typeof payload?.currency === "string"
      ? payload.currency.trim().toUpperCase()
      : "";

  const status =
    typeof payload?.status === "string"
      ? payload.status.trim().toLowerCase()
      : "";

  const amount = payload?.amount;

  if (
    !paymentId ||
    !checkoutId ||
    currency !== "ZAR" ||
    status !== "succeeded" ||
    !Number.isSafeInteger(amount) ||
    Number(amount) <= 0
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid successful-payment payload." },
      { status: 400 },
    );
  }

  const amountCents = Number(amount);
  const bodyHash = sha256(rawBody);

  const [
    { data: customerAttempt, error: customerLookupError },
    { data: driverAttempt, error: driverLookupError },
  ] = await Promise.all([
    supabaseAdmin.from("online_payment_attempts").select("id").eq("provider", "YOCO").eq("provider_checkout_id", checkoutId).maybeSingle(),
    supabaseAdmin.from("driver_online_payment_attempts").select("id").eq("provider", "YOCO").eq("provider_checkout_id", checkoutId).maybeSingle(),
  ]);
  if (customerLookupError || driverLookupError) {
    return NextResponse.json({ ok: false, error: "Payment verification failed." }, { status: 500 });
  }

  const configuredMode = normalizeYocoMode(process.env.YOCO_ENVIRONMENT);
  if (!configuredMode) {
    return NextResponse.json({ ok: false, error: "Yoco environment isolation is not configured." }, { status: 503 });
  }
  if (!yocoEventModeMatches(payload?.mode, configuredMode)) {
    console.error("[yoco-webhook] provider mode mismatch", { eventId, configuredMode });
    return NextResponse.json({ ok: false, error: "Webhook environment mismatch." }, { status: 409 });
  }
  if ([customerAttempt, driverAttempt].filter(Boolean).length > 1) {
    console.error("[yoco-webhook] ambiguous checkout authority", { eventId, checkoutId });
    return NextResponse.json({ ok: false, error: "Payment authority conflict." }, { status: 409 });
  }

  const processor = driverAttempt
    ? "phase3_process_trusted_driver_payment_event"
    : "phase3_process_trusted_payment_event";
  const { data: processingResult, error: processingError } = await supabaseAdmin.rpc(processor, {
      p_provider: "YOCO",
      p_event_id: eventId,
      p_event_type: eventType,
      p_raw_status: status,
      p_body_sha256: bodyHash,
      p_checkout_id: checkoutId,
      p_payment_id: paymentId,
      p_amount_cents: amountCents,
      p_currency: currency,
      p_outcome: "SUCCEEDED",
  });

  if (processingError) {
    console.error("[yoco-webhook] trusted processor failed", {
      code: processingError.code,
      message: processingError.message,
      eventId,
      paymentDomain: driverAttempt ? "DRIVER_COMMISSION" : "CUSTOMER_TRIP",
    });

    return NextResponse.json(
      {
        ok: false,
        error: "Verified payment could not be processed.",
      },
      { status: 500 },
    );
  }

  let dispatchPending = false;
  if (customerAttempt && ["SUCCEEDED", "REPLAYED"].includes(String(processingResult?.result ?? ""))) {
    try {
      await dispatchVerifiedOnlineTrip(customerAttempt.id);
    } catch (error) {
      dispatchPending = true;
      console.error("[yoco-webhook] verified payment dispatch deferred", {
        attemptId: customerAttempt.id,
        reason: error instanceof Error ? error.message : "Unknown dispatch error",
      });
    }
  }
  return NextResponse.json({
    ok: true,
    verified: true,
    processed: true,
    result: processingResult,
    dispatchPending,
  });
}
