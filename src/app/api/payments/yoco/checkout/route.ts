import { NextResponse } from "next/server";
import { createHash } from "crypto";

import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { createYocoCheckout } from "@/lib/payments/yoco/client";

type CheckoutBody = {
  tripId?: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function getAppBaseUrl(req: Request): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthenticatedCustomer(req);

    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
    }

    if (auth.customer.status !== "active") {
      return NextResponse.json(
        { ok: false, error: "Your customer account is not active." },
        { status: 403 },
      );
    }

    const body = (await req.json()) as CheckoutBody;
    const tripId = String(body.tripId ?? "").trim();

    if (!/^[0-9a-f-]{36}$/i.test(tripId)) {
      return NextResponse.json(
        { ok: false, error: "A valid trip ID is required." },
        { status: 400 },
      );
    }

    // Never trust a fare sent by the customer.
    // Read the trip and authoritative fare from MOOVU.
    const { data: trip, error: tripError } = await auth.supabaseAdmin
      .from("trips")
      .select("id, customer_id, payment_method, fare_amount, status")
      .eq("id", tripId)
      .eq("customer_id", auth.customer.id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json(
        { ok: false, error: "Trip not found." },
        { status: 404 },
      );
    }

    if (String(trip.payment_method ?? "").toLowerCase() !== "online") {
      return NextResponse.json(
        { ok: false, error: "This trip is not configured for online payment." },
        { status: 409 },
      );
    }

    const fareRands = Number(trip.fare_amount);

    if (!Number.isFinite(fareRands) || fareRands <= 0) {
      return NextResponse.json(
        { ok: false, error: "The trip fare is invalid." },
        { status: 409 },
      );
    }

    const amountCents = Math.round(fareRands * 100);

    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return NextResponse.json(
        { ok: false, error: "The trip fare cannot be charged." },
        { status: 409 },
      );
    }

    const lockedFareSnapshot = {
      tripId: trip.id,
      customerId: auth.customer.id,
      amountCents,
      currency: "ZAR",
      source: "trip_server_fare",
    };

    const fareVersion = sha256(
      JSON.stringify({
        tripId: trip.id,
        amountCents,
        currency: "ZAR",
      }),
    );

    const idempotencyKey = `yoco-checkout:${trip.id}:${fareVersion}`;

    const payloadHash = sha256(
      JSON.stringify({
        provider: "YOCO",
        tripId: trip.id,
        customerId: auth.customer.id,
        amountCents,
        currency: "ZAR",
        fareVersion,
      }),
    );

    /*
     * Reuse an existing active payment attempt if this request
     * is retried instead of creating duplicate financial authority.
     */
    const { data: existingAttempt, error: existingError } =
      await auth.supabaseAdmin
        .from("online_payment_attempts")
        .select(
          "id, provider_checkout_id, provider_redirect_url, state, amount_cents, currency, fare_version",
        )
        .eq("trip_id", trip.id)
        .eq("fare_version", fareVersion)
        .in("state", [
          "CREATED",
          "PENDING",
          "SUCCEEDED",
          "REFUND_PENDING",
          "PARTIALLY_REFUNDED",
        ])
        .maybeSingle();

    if (existingError) {
      console.error("[yoco-checkout] payment lookup failed", {
        code: existingError.code,
        message: existingError.message,
      });

      return NextResponse.json(
        { ok: false, error: "Online payment is currently unavailable." },
        { status: 503 },
      );
    }

    if (existingAttempt?.state === "SUCCEEDED") {
      return NextResponse.json(
        {
          ok: false,
          code: "PAYMENT_ALREADY_SUCCEEDED",
          error: "This trip has already been paid.",
        },
        { status: 409 },
      );
    }

    if (
      existingAttempt?.state === "PENDING" &&
      existingAttempt.provider_checkout_id
    ) {
      return NextResponse.json({
        ok: true,
        checkoutId: existingAttempt.provider_checkout_id,
        redirectUrl: existingAttempt.provider_redirect_url,
        reused: true,
      });
    }

    let attemptId = existingAttempt?.id ?? null;

    if (!attemptId) {
      const { data: createdAttempt, error: createAttemptError } =
        await auth.supabaseAdmin
          .from("online_payment_attempts")
          .insert({
            customer_id: auth.customer.id,
            trip_id: trip.id,
            provider: "YOCO",
            payment_method: "ONLINE",
            amount_cents: amountCents,
            currency: "ZAR",
            fare_version: fareVersion,
            locked_fare_snapshot: lockedFareSnapshot,
            state: "CREATED",
            idempotency_key: idempotencyKey,
            payload_hash: payloadHash,
          })
          .select("id")
          .single();

      if (createAttemptError || !createdAttempt) {
        console.error("[yoco-checkout] attempt creation failed", {
          code: createAttemptError?.code,
          message: createAttemptError?.message,
        });

        return NextResponse.json(
          { ok: false, error: "We couldn't prepare the online payment." },
          { status: 500 },
        );
      }

      attemptId = createdAttempt.id;
    }

    const appBaseUrl = getAppBaseUrl(req);

    const yocoCheckout = await createYocoCheckout({
      amountCents,
      currency: "ZAR",

      successUrl: `${appBaseUrl}/payment/success?tripId=${encodeURIComponent(trip.id)}`,

      cancelUrl: `${appBaseUrl}/payment/cancel?tripId=${encodeURIComponent(trip.id)}`,

      failureUrl: `${appBaseUrl}/payment/failure?tripId=${encodeURIComponent(trip.id)}`,

      metadata: {
        tripId: trip.id,
        paymentAttemptId: attemptId,
      },
    });

    const { error: updateError } = await auth.supabaseAdmin
      .from("online_payment_attempts")
      .update({
        provider_checkout_id: yocoCheckout.id,
        provider_redirect_url: yocoCheckout.redirectUrl,
        raw_provider_state: yocoCheckout.status ?? "created",
        state: "PENDING",
        updated_at: new Date().toISOString(),
      })
      .eq("id", attemptId)
      .eq("state", "CREATED");

    if (updateError) {
      console.error("[yoco-checkout] attempt update failed", {
        code: updateError.code,
        message: updateError.message,
      });

      return NextResponse.json(
        {
          ok: false,
          error:
            "The payment checkout was created but could not be recorded safely.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      checkoutId: yocoCheckout.id,
      redirectUrl: yocoCheckout.redirectUrl,
    });
  } catch (error: unknown) {
    console.error(
      "[yoco-checkout] unexpected failure",
      error instanceof Error ? error.message : "Unknown error",
    );

    return NextResponse.json(
      { ok: false, error: "Online payment is currently unavailable." },
      { status: 500 },
    );
  }
}
