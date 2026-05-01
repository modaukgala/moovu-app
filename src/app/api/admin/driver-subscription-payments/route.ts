import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { supabaseAdmin, user } = auth;
    const body = await req.json();

    const driverId = String(body?.driverId ?? "").trim();
    const amountPaid = num(body?.amountPaid);
    const paymentMethod = String(body?.paymentMethod ?? "eft").trim() || "eft";
    const reference = String(body?.reference ?? "").trim();
    const note = String(body?.note ?? "").trim();

    if (!driverId) {
      return NextResponse.json(
        { ok: false, error: "Driver ID is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      return NextResponse.json(
        { ok: false, error: "Amount paid must be greater than zero." },
        { status: 400 }
      );
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id,subscription_amount_due")
      .eq("id", driverId)
      .maybeSingle();

    if (driverError) {
      return NextResponse.json(
        { ok: false, error: driverError.message },
        { status: 500 }
      );
    }

    if (!driver) {
      return NextResponse.json(
        { ok: false, error: "Driver not found." },
        { status: 404 }
      );
    }

    const currentDue = num(driver.subscription_amount_due);

    if (currentDue <= 0) {
      return NextResponse.json(
        { ok: false, error: "This driver does not currently owe a subscription amount." },
        { status: 400 }
      );
    }

    if (amountPaid > currentDue + 0.009) {
      return NextResponse.json(
        { ok: false, error: `Amount exceeds current subscription due of R${currentDue.toFixed(2)}.` },
        { status: 400 }
      );
    }

    const { error: insertError } = await supabaseAdmin
      .from("driver_subscription_payments")
      .insert({
        driver_id: driverId,
        amount_paid: amountPaid,
        payment_method: paymentMethod,
        reference: reference || null,
        note: note || null,
        received_by: user.id,
      });

    if (insertError) {
      return NextResponse.json(
        { ok: false, error: insertError.message },
        { status: 500 }
      );
    }

    const newDue = Math.max(0, currentDue - amountPaid);

    const { error: updateError } = await supabaseAdmin
      .from("drivers")
      .update({
        subscription_amount_due: newDue,
        subscription_last_paid_at: new Date().toISOString(),
        subscription_last_payment_amount: amountPaid,
        updated_at: new Date().toISOString(),
      })
      .eq("id", driverId);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Subscription payment recorded successfully.",
      subscriptionAmountDue: newDue,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error.") },
      { status: 500 }
    );
  }
}
