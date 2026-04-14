import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

const PLAN_DAYS = {
  day: 1,
  week: 7,
  month: 30,
} as const;

type PlanType = keyof typeof PLAN_DAYS;

function isPlanType(value: string): value is PlanType {
  return value === "day" || value === "week" || value === "month";
}

function addDays(base: Date, days: number) {
  const copy = new Date(base);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
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
    const planType = String(body?.planType ?? "").trim();
    const amountPaid = num(body?.amountPaid);
    const paymentMethod = String(body?.paymentMethod ?? "eft").trim() || "eft";
    const reference = String(body?.reference ?? "").trim();
    const note = String(body?.note ?? "").trim();
    const requestId = String(body?.requestId ?? "").trim();

    if (!driverId) {
      return NextResponse.json(
        { ok: false, error: "Driver ID is required." },
        { status: 400 }
      );
    }

    if (!isPlanType(planType)) {
      return NextResponse.json(
        { ok: false, error: "Invalid subscription plan." },
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
      .select(`
        id,
        subscription_expires_at,
        subscription_amount_due
      `)
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

    const now = new Date();
    const currentExpiry =
      driver.subscription_expires_at && new Date(driver.subscription_expires_at).getTime() > now.getTime()
        ? new Date(driver.subscription_expires_at)
        : now;

    const newExpiry = addDays(currentExpiry, PLAN_DAYS[planType]);

    const { error: paymentInsertError } = await supabaseAdmin
      .from("driver_subscription_payments")
      .insert({
        driver_id: driverId,
        amount_paid: amountPaid,
        payment_method: paymentMethod,
        reference: reference || null,
        note: note || null,
        received_by: user.id,
      });

    if (paymentInsertError) {
      return NextResponse.json(
        { ok: false, error: paymentInsertError.message },
        { status: 500 }
      );
    }

    const { error: driverUpdateError } = await supabaseAdmin
      .from("drivers")
      .update({
        subscription_status: "active",
        subscription_plan: planType,
        subscription_expires_at: newExpiry.toISOString(),
        subscription_amount_due: 0,
        subscription_last_paid_at: now.toISOString(),
        subscription_last_payment_amount: amountPaid,
        updated_at: now.toISOString(),
      })
      .eq("id", driverId);

    if (driverUpdateError) {
      return NextResponse.json(
        { ok: false, error: driverUpdateError.message },
        { status: 500 }
      );
    }

    if (requestId) {
      await supabaseAdmin
        .from("driver_subscription_requests")
        .update({
          status: "confirmed",
          confirmed_at: now.toISOString(),
          confirmed_by: user.id,
        })
        .eq("id", requestId);
    }

    return NextResponse.json({
      ok: true,
      message: `Subscription activated successfully until ${newExpiry.toLocaleString()}.`,
      subscription_expires_at: newExpiry.toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to activate subscription." },
      { status: 500 }
    );
  }
}