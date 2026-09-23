import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedDriver } from "@/lib/payments/driverServer";
import { resolveDriverFinanceAuthority } from "@/lib/finance/phase2DriverEligibility";
import { createYocoCheckout } from "@/lib/payments/yoco/client";

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function baseUrl(req: Request) {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || new URL(req.url).origin).replace(/\/+$/, "");
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthenticatedDriver(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

    const { data: driver, error: driverError } = await auth.supabaseAdmin.from("drivers")
      .select("id,subscription_status,subscription_expires_at")
      .eq("id", auth.driverId).maybeSingle();
    if (driverError || !driver) return NextResponse.json({ ok: false, error: "Driver account is unavailable." }, { status: 503 });

    const finance = await resolveDriverFinanceAuthority(auth.supabaseAdmin, {
      driverId: auth.driverId,
      subscriptionStatus: driver.subscription_status,
      subscriptionExpiresAt: driver.subscription_expires_at,
    });
    if (!finance.ok) return NextResponse.json({ ok: false, error: finance.error }, { status: 503 });
    if (finance.authority.mode !== "AUTHORITATIVE" || finance.authority.subscriptionRequired) {
      return NextResponse.json({ ok: false, error: "Online commission payment is unavailable for the current finance policy." }, { status: 409 });
    }
    const amountCents = finance.authority.netOwedCents;
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return NextResponse.json({ ok: false, error: "You do not currently owe MOOVU commission." }, { status: 409 });
    }

    const snapshot = {
      driverId: auth.driverId,
      obligationType: "COMMISSION_DEBT",
      debtCents: finance.authority.debtCents,
      unappliedCreditCents: finance.authority.unappliedCreditCents,
      netOwedCents: amountCents,
      policyId: finance.authority.policyId,
      financeMode: finance.authority.mode,
      currency: "ZAR",
    };
    const obligationVersion = sha256(JSON.stringify(snapshot));
    const idempotencyKey = `yoco-driver-commission:${auth.driverId}:${obligationVersion}`;
    const payloadHash = sha256(JSON.stringify({ provider: "YOCO", ...snapshot, obligationVersion }));

    const { data: existing, error: existingError } = await auth.supabaseAdmin.from("driver_online_payment_attempts")
      .select("id,state,provider_checkout_id,provider_redirect_url,amount_cents,currency")
      .eq("driver_id", auth.driverId).eq("obligation_type", "COMMISSION_DEBT")
      .in("state", ["CREATED", "PENDING", "RECONCILIATION_REQUIRED"])
      .maybeSingle();
    if (existingError) return NextResponse.json({ ok: false, error: "Online payment is currently unavailable." }, { status: 503 });
    if (existing?.state === "RECONCILIATION_REQUIRED") {
      return NextResponse.json({ ok: false, code: "PAYMENT_REVIEW_REQUIRED", attemptId: existing.id, error: "A commission payment needs review before another checkout can be created." }, { status: 409 });
    }
    if (existing?.state === "PENDING" && existing.provider_checkout_id && existing.provider_redirect_url) {
      return NextResponse.json({ ok: true, attemptId: existing.id, checkoutId: existing.provider_checkout_id, redirectUrl: existing.provider_redirect_url, reused: true });
    }

    let attemptId = existing?.id as string | undefined;
    if (!attemptId) {
      const { data: created, error: createError } = await auth.supabaseAdmin.from("driver_online_payment_attempts").insert({
        driver_id: auth.driverId, provider: "YOCO", obligation_type: "COMMISSION_DEBT",
        obligation_version: obligationVersion, obligation_snapshot: snapshot, amount_cents: amountCents,
        currency: "ZAR", state: "CREATED", idempotency_key: idempotencyKey, payload_hash: payloadHash,
      }).select("id").single();
      if (createError || !created) {
        const { data: raced } = await auth.supabaseAdmin.from("driver_online_payment_attempts")
          .select("id,state,provider_checkout_id,provider_redirect_url")
          .eq("driver_id", auth.driverId).eq("obligation_type", "COMMISSION_DEBT")
          .in("state", ["CREATED", "PENDING", "RECONCILIATION_REQUIRED"]).maybeSingle();
        if (raced?.state === "PENDING" && raced.provider_redirect_url) {
          return NextResponse.json({ ok: true, attemptId: raced.id, checkoutId: raced.provider_checkout_id, redirectUrl: raced.provider_redirect_url, reused: true });
        }
        return NextResponse.json({ ok: false, error: "We couldn't prepare the online commission payment." }, { status: 409 });
      }
      attemptId = created.id;
    }
    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "Payment attempt creation failed." }, { status: 500 });
    }

    const app = baseUrl(req);
    const checkout = await createYocoCheckout({
      amountCents, currency: "ZAR",
      successUrl: `${app}/driver/payment/success?attemptId=${encodeURIComponent(attemptId)}`,
      cancelUrl: `${app}/driver/payment/cancel?attemptId=${encodeURIComponent(attemptId)}`,
      failureUrl: `${app}/driver/payment/failure?attemptId=${encodeURIComponent(attemptId)}`,
      metadata: { paymentDomain: "DRIVER_COMMISSION", driverId: auth.driverId, paymentAttemptId: attemptId },
    });
    const { data: updated, error: updateError } = await auth.supabaseAdmin.from("driver_online_payment_attempts")
      .update({ provider_checkout_id: checkout.id, provider_redirect_url: checkout.redirectUrl,
        raw_provider_state: checkout.status ?? "created", state: "PENDING", updated_at: new Date().toISOString() })
      .eq("id", attemptId).eq("state", "CREATED").select("id").maybeSingle();
    if (updateError || !updated) return NextResponse.json({ ok: false, error: "The checkout was created but could not be recorded safely." }, { status: 500 });
    return NextResponse.json({ ok: true, attemptId, checkoutId: checkout.id, redirectUrl: checkout.redirectUrl });
  } catch (error) {
    console.error("[yoco-driver-checkout] failure", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ ok: false, error: "Online payment is currently unavailable." }, { status: 500 });
  }
}
