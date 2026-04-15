import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const PLAN_PRICES = {
  day: 45,
  week: 100,
  month: 250,
} as const;

type PaymentType = "subscription" | "commission" | "combined";
type SubscriptionPlan = keyof typeof PLAN_PRICES;

function isPaymentType(value: string): value is PaymentType {
  return value === "subscription" || value === "commission" || value === "combined";
}

function isSubscriptionPlan(value: string): value is SubscriptionPlan {
  return value === "day" || value === "week" || value === "month";
}

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 401 });
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const formData = await req.formData();

    const paymentTypeRaw = String(formData.get("paymentType") ?? "").trim();
    const subscriptionPlanRaw = String(formData.get("subscriptionPlan") ?? "").trim();
    const amountSubmitted = num(formData.get("amountSubmitted"));
    const note = String(formData.get("note") ?? "").trim();
    const file = formData.get("pop") as File | null;

    if (!isPaymentType(paymentTypeRaw)) {
      return NextResponse.json({ ok: false, error: "Invalid payment type." }, { status: 400 });
    }

    const paymentType = paymentTypeRaw as PaymentType;

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: account, error: accountError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (accountError || !account?.driver_id) {
      return NextResponse.json({ ok: false, error: "Driver account is not linked." }, { status: 404 });
    }

    const driverId = account.driver_id;

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select(`
        id,
        subscription_amount_due,
        subscription_status,
        subscription_plan,
        subscription_expires_at
      `)
      .eq("id", driverId)
      .maybeSingle();

    if (driverError || !driver) {
      return NextResponse.json({ ok: false, error: driverError?.message || "Driver not found." }, { status: 404 });
    }

    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("driver_wallets")
      .select("balance_due")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (walletError) {
      return NextResponse.json({ ok: false, error: walletError.message }, { status: 500 });
    }

    const commissionDue = num(wallet?.balance_due);
    const subscriptionDueExisting = num(driver.subscription_amount_due);

    let subscriptionPlan: SubscriptionPlan | null = null;
    let subscriptionExpected = 0;

    if (paymentType === "subscription" || paymentType === "combined") {
      if (!isSubscriptionPlan(subscriptionPlanRaw)) {
        return NextResponse.json({ ok: false, error: "Please choose a valid subscription plan." }, { status: 400 });
      }

      subscriptionPlan = subscriptionPlanRaw;
      subscriptionExpected = PLAN_PRICES[subscriptionPlan];
    }

    let amountExpected = 0;

    if (paymentType === "subscription") {
      amountExpected = subscriptionExpected;
    } else if (paymentType === "commission") {
      amountExpected = commissionDue;
    } else {
      amountExpected = subscriptionExpected + commissionDue;
    }

    if (amountExpected <= 0) {
      return NextResponse.json(
        { ok: false, error: "There is no payable amount for this request." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(amountSubmitted) || amountSubmitted <= 0) {
      return NextResponse.json(
        { ok: false, error: "Please enter the amount you paid." },
        { status: 400 }
      );
    }

    const refParts = [
      paymentType === "subscription" ? "SUB" : paymentType === "commission" ? "COMM" : "ALL",
      driverId.slice(0, 6).toUpperCase(),
      subscriptionPlan ? subscriptionPlan.toUpperCase() : null,
    ].filter(Boolean);

    const paymentReference = refParts.join("-");

    let popFilePath: string | null = null;
    let popFileUrl: string | null = null;

    if (file && file.size > 0) {
      const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
      if (!allowed.includes(file.type)) {
        return NextResponse.json(
          { ok: false, error: "POP must be JPG, PNG, WEBP, or PDF." },
          { status: 400 }
        );
      }

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const safeName = `${driverId}/${Date.now()}-${file.name.replace(/\s+/g, "_")}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from("payment-proofs")
        .upload(safeName, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });
      }

      const { data: publicUrlData } = supabaseAdmin.storage
        .from("payment-proofs")
        .getPublicUrl(safeName);

      popFilePath = safeName;
      popFileUrl = publicUrlData?.publicUrl ?? null;
    }

    const { error: insertError } = await supabaseAdmin
      .from("driver_payment_requests")
      .insert({
        driver_id: driverId,
        payment_type: paymentType,
        subscription_plan: subscriptionPlan,
        amount_expected: amountExpected,
        amount_submitted: amountSubmitted,
        payment_reference: paymentReference,
        note: note || null,
        pop_file_path: popFilePath,
        pop_file_url: popFileUrl,
        status: "pending_payment_review",
      });

    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    }

    if (paymentType === "subscription" || paymentType === "combined") {
      const nextSubscriptionDue = subscriptionExpected;

      await supabaseAdmin
        .from("drivers")
        .update({
          subscription_amount_due: nextSubscriptionDue,
          updated_at: new Date().toISOString(),
        })
        .eq("id", driverId);
    }

    return NextResponse.json({
      ok: true,
      message: "Payment submitted successfully. Waiting for admin review.",
      paymentType,
      subscriptionPlan,
      amountExpected,
      amountSubmitted,
      paymentReference,
      commissionDue,
      subscriptionDueExisting,
      popFileUrl,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to submit payment." },
      { status: 500 }
    );
  }
}