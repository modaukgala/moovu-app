import { createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedDriver } from "@/lib/payments/driverServer";
import { resolveDriverFinanceAuthority } from "@/lib/finance/phase2DriverEligibility";
import { createYocoCheckout, getYocoCheckoutConfiguration } from "@/lib/payments/yoco/client";
import { YocoCheckoutError } from "@/lib/payments/yoco/checkoutContract";
import { ADMISSION_CLOSED_CODE, ADMISSION_CLOSED_MESSAGE, isAdmissionClosed } from "@/lib/maintenance/admission";

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function validCheckoutUrl(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.origin === "https://c.yoco.com" && !url.username && !url.password;
  } catch { return false; }
}
function baseUrl(req: Request) {
  const url = new URL(req.url);
  return url.hostname === "moovurides.co.za" || url.hostname.endsWith(".moovurides.co.za")
    ? "https://driver.moovurides.co.za" : url.origin;
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
    const payloadHash = sha256(JSON.stringify({ provider: "YOCO", ...snapshot, obligationVersion }));

    const { data: existing, error: existingError } = await auth.supabaseAdmin.from("driver_online_payment_attempts")
      .select("id,state,provider_checkout_id,provider_redirect_url,amount_cents,currency,obligation_version")
      .eq("driver_id", auth.driverId).eq("obligation_type", "COMMISSION_DEBT")
      .in("state", ["CREATED", "PENDING", "RECONCILIATION_REQUIRED"])
      .maybeSingle();
    if (existingError) return NextResponse.json({ ok: false, error: "Online payment is currently unavailable." }, { status: 503 });
    if (existing?.state === "RECONCILIATION_REQUIRED") {
      return NextResponse.json({ ok: false, code: "PAYMENT_REVIEW_REQUIRED", attemptId: existing.id, error: "A commission payment needs review before another checkout can be created." }, { status: 409 });
    }
    if (existing?.state === "PENDING") {
      if (existing.provider_checkout_id && validCheckoutUrl(existing.provider_redirect_url)
        && Number(existing.amount_cents) === amountCents && existing.currency === "ZAR"
        && existing.obligation_version === obligationVersion) {
        return NextResponse.json({ ok: true, attemptId: existing.id, checkoutId: existing.provider_checkout_id, redirectUrl: existing.provider_redirect_url, reused: true });
      }
      return NextResponse.json({ ok: false, code: "PAYMENT_REVIEW_REQUIRED", attemptId: existing.id,
        error: "Your existing payment needs a status check before another checkout can be created." }, { status: 409 });
    }

    let attemptId = existing?.id as string | undefined;
    if (existing?.state === "CREATED") {
      return NextResponse.json({ ok: false, code: "PAYMENT_IN_PROGRESS", error: "Uncertain checkout requires reconciliation before retry. Check its status before starting another payment." }, { status: 409 });
    }
    if (!attemptId) {
      // Fail before reserving an active attempt when no provider call is possible.
      try { getYocoCheckoutConfiguration(); } catch {
        return NextResponse.json({ ok: false, code: "PAYMENT_UNAVAILABLE", error: "Online payments are temporarily unavailable. Please try again shortly." }, { status: 503 });
      }
      const newAttemptId = randomUUID();
      // Equal debt can recur after settlement; the balance hash is not a payment identity.
      const idempotencyKey = `yoco-driver-commission:${auth.driverId}:${obligationVersion}:${newAttemptId}`;
      const { data: created, error: createError } = await auth.supabaseAdmin.from("driver_online_payment_attempts").insert({
        id: newAttemptId,
        driver_id: auth.driverId, provider: "YOCO", obligation_type: "COMMISSION_DEBT",
        obligation_version: obligationVersion, obligation_snapshot: snapshot, amount_cents: amountCents,
        currency: "ZAR", state: "CREATED", idempotency_key: idempotencyKey, payload_hash: payloadHash,
      }).select("id").single();
      if (createError || !created) {
        if (isAdmissionClosed(createError)) {
          return NextResponse.json({ ok: false, code: ADMISSION_CLOSED_CODE,
            error: ADMISSION_CLOSED_MESSAGE }, { status: 503 });
        }
        const { data: raced } = await auth.supabaseAdmin.from("driver_online_payment_attempts")
          .select("id,state,provider_checkout_id,provider_redirect_url,amount_cents,currency,obligation_version")
          .eq("driver_id", auth.driverId).eq("obligation_type", "COMMISSION_DEBT")
          .in("state", ["CREATED", "PENDING", "RECONCILIATION_REQUIRED"]).maybeSingle();
        if (raced?.state === "PENDING" && raced.provider_checkout_id && validCheckoutUrl(raced.provider_redirect_url)
          && Number(raced.amount_cents) === amountCents && raced.currency === "ZAR"
          && raced.obligation_version === obligationVersion) {
          return NextResponse.json({ ok: true, attemptId: raced.id, checkoutId: raced.provider_checkout_id, redirectUrl: raced.provider_redirect_url, reused: true });
        }
        if (!raced) console.error("[yoco-driver-checkout] reservation failed", { code: createError?.code ?? "NO_ROW", correlationId: newAttemptId });
        return NextResponse.json({ ok: false, code: raced ? "PAYMENT_IN_PROGRESS" : "PAYMENT_PREPARATION_FAILED",
          error: raced ? "You already have a payment in progress. Continue or check its status." : "Online payments are temporarily unavailable. Please try again shortly." }, { status: raced ? 409 : 503 });
      }
      attemptId = created.id;
    }
    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "Payment attempt creation failed." }, { status: 500 });
    }

    const app = baseUrl(req);
    let checkout: Awaited<ReturnType<typeof createYocoCheckout>>;
    try {
      checkout = await createYocoCheckout({
        idempotencyKey: `moovu:checkout:${attemptId}`,
        amountCents, currency: "ZAR",
        successUrl: `${app}/driver/payment/success?attemptId=${encodeURIComponent(attemptId)}`,
        cancelUrl: `${app}/driver/payment/cancel?attemptId=${encodeURIComponent(attemptId)}`,
        failureUrl: `${app}/driver/payment/failure?attemptId=${encodeURIComponent(attemptId)}`,
        metadata: { paymentDomain: "DRIVER_COMMISSION", driverId: auth.driverId, paymentAttemptId: attemptId },
      });
    } catch (error) {
      // Only a definite provider rejection releases the active reservation.
      // Timeouts, conflicts and malformed replies can conceal a chargeable checkout.
      let retryAvailable = false;
      if (error instanceof YocoCheckoutError && error.outcome === "NOT_CREATED") {
        const { data: released, error: releaseError } = await auth.supabaseAdmin.from("driver_online_payment_attempts")
          .update({ state: "FAILED", raw_provider_state: "checkout_rejected", updated_at: new Date().toISOString() })
          .eq("id", attemptId).eq("state", "CREATED").is("provider_checkout_id", null).select("id").maybeSingle();
        retryAvailable = !releaseError && Boolean(released);
        if (!retryAvailable) console.error("[yoco-driver-checkout] rejected attempt requires review", { correlationId: attemptId });
      }
      console.error("[yoco-driver-checkout] provider preparation failed", { correlationId: attemptId,
        outcome: error instanceof YocoCheckoutError ? error.outcome : "UNKNOWN" });
      return NextResponse.json({ ok: false, code: retryAvailable ? "PAYMENT_RETRY_AVAILABLE" : "PAYMENT_REVIEW_REQUIRED",
        error: retryAvailable
          ? "Online payments are temporarily unavailable. Please try again shortly."
          : "Your payment preparation needs a status check before retrying. Please contact support if it does not update." }, { status: 503 });
    }
    const { data: updated, error: updateError } = await auth.supabaseAdmin.from("driver_online_payment_attempts")
      .update({ provider_checkout_id: checkout.id, provider_redirect_url: checkout.redirectUrl,
        raw_provider_state: checkout.status ?? "created", state: "PENDING", updated_at: new Date().toISOString() })
      .eq("id", attemptId).eq("state", "CREATED").select("id").maybeSingle();
    if (updateError || !updated) return NextResponse.json({ ok: false, error: "The checkout was created but could not be recorded safely." }, { status: 500 });
    return NextResponse.json({ ok: true, attemptId, checkoutId: checkout.id, redirectUrl: checkout.redirectUrl });
  } catch (error) {
    console.error("[yoco-driver-checkout] unexpected preparation failure", { category: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ ok: false, error: "Online payment is currently unavailable." }, { status: 500 });
  }
}
