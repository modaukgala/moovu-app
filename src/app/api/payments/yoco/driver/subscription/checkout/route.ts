import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedDriver } from "@/lib/payments/driverServer";
import { createYocoCheckout } from "@/lib/payments/yoco/client";
import { DRIVER_SUBSCRIPTION_PLANS, isDriverSubscriptionPlan } from "@/lib/finance/driverPayments";

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function baseUrl(req: Request) {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || new URL(req.url).origin).replace(/\/+$/, "");
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthenticatedDriver(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => null) as { plan?: unknown } | null;
    const plan = typeof body?.plan === "string" ? body.plan.trim().toLowerCase() : "";
    if (!isDriverSubscriptionPlan(plan)) return NextResponse.json({ ok: false, error: "Select a valid subscription plan." }, { status: 400 });

    const definition = DRIVER_SUBSCRIPTION_PLANS[plan];
    const amountCents = definition.amount * 100;
    const authority = { driverId: auth.driverId, plan, days: definition.days, amountCents, currency: "ZAR" };
    const authorityVersion = sha256(JSON.stringify(authority));
    const idempotencyKey = `yoco-driver-subscription:${auth.driverId}:${authorityVersion}`;
    const payloadHash = sha256(JSON.stringify({ provider: "YOCO", ...authority, authorityVersion }));

    const { data: existing, error: lookupError } = await auth.supabaseAdmin
      .from("driver_subscription_online_payment_attempts")
      .select("id,state,provider_checkout_id,provider_redirect_url")
      .eq("driver_id", auth.driverId).eq("plan", plan)
      .in("state", ["CREATED", "PENDING", "RECONCILIATION_REQUIRED"]).maybeSingle();
    if (lookupError) return NextResponse.json({ ok: false, error: "Online subscription payment is unavailable." }, { status: 503 });
    if (existing?.state === "RECONCILIATION_REQUIRED") return NextResponse.json({ ok: false, error: "A subscription payment needs review before another checkout can be created." }, { status: 409 });
    if (existing?.state === "PENDING" && existing.provider_redirect_url) return NextResponse.json({ ok: true, attemptId: existing.id, checkoutId: existing.provider_checkout_id, redirectUrl: existing.provider_redirect_url, reused: true });

    let attemptId = existing?.id as string | undefined;
    if (!attemptId) {
      const { data: created, error } = await auth.supabaseAdmin.from("driver_subscription_online_payment_attempts").insert({
        driver_id: auth.driverId, provider: "YOCO", plan, plan_days: definition.days, amount_cents: amountCents,
        currency: "ZAR", authority_version: authorityVersion, authority_snapshot: authority,
        idempotency_key: idempotencyKey, payload_hash: payloadHash, state: "CREATED",
      }).select("id").single();
      if (error || !created) return NextResponse.json({ ok: false, error: "We couldn't prepare the subscription payment." }, { status: 409 });
      attemptId = created.id;
    }
    if (!attemptId) return NextResponse.json({ ok: false, error: "Payment attempt creation failed." }, { status: 500 });

    const app = baseUrl(req);
    const checkout = await createYocoCheckout({
      amountCents, currency: "ZAR",
      successUrl: `${app}/driver/subscription/payment/success?attemptId=${encodeURIComponent(attemptId)}`,
      cancelUrl: `${app}/driver/subscription/payment/cancel?attemptId=${encodeURIComponent(attemptId)}`,
      failureUrl: `${app}/driver/subscription/payment/failure?attemptId=${encodeURIComponent(attemptId)}`,
      metadata: { paymentDomain: "DRIVER_SUBSCRIPTION", driverId: auth.driverId, paymentAttemptId: attemptId, plan },
    });
    const { data: updated, error: updateError } = await auth.supabaseAdmin.from("driver_subscription_online_payment_attempts")
      .update({ provider_checkout_id: checkout.id, provider_redirect_url: checkout.redirectUrl, raw_provider_state: checkout.status ?? "created", state: "PENDING", updated_at: new Date().toISOString() })
      .eq("id", attemptId).eq("state", "CREATED").select("id").maybeSingle();
    if (updateError || !updated) return NextResponse.json({ ok: false, error: "The checkout was created but could not be recorded safely." }, { status: 500 });
    return NextResponse.json({ ok: true, attemptId, checkoutId: checkout.id, redirectUrl: checkout.redirectUrl, amountCents });
  } catch (error) {
    console.error("[yoco-driver-subscription-checkout] failure", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ ok: false, error: "Online subscription payment is unavailable." }, { status: 500 });
  }
}
