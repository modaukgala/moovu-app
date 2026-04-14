import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const PLAN_PRICES = {
  day: 45,
  week: 100,
  month: 250,
} as const;

type PlanType = keyof typeof PLAN_PRICES;

function isPlanType(value: string): value is PlanType {
  return value === "day" || value === "week" || value === "month";
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing access token." },
        { status: 401 }
      );
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
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const planType = String(body?.planType ?? "").trim();
    const note = String(body?.note ?? "").trim();

    if (!isPlanType(planType)) {
      return NextResponse.json(
        { ok: false, error: "Invalid subscription plan." },
        { status: 400 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: account, error: accountError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (accountError || !account?.driver_id) {
      return NextResponse.json(
        { ok: false, error: "Driver account is not linked." },
        { status: 404 }
      );
    }

    const driverId = account.driver_id;
    const expectedAmount = PLAN_PRICES[planType];
    const paymentReference = `SUB-${driverId.slice(0, 6).toUpperCase()}-${planType.toUpperCase()}`;

    const { error: insertError } = await supabaseAdmin
      .from("driver_subscription_requests")
      .insert({
        driver_id: driverId,
        plan_type: planType,
        amount_expected: expectedAmount,
        payment_reference: paymentReference,
        note: note || null,
        status: "pending",
      });

    if (insertError) {
      return NextResponse.json(
        { ok: false, error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Subscription request created. Pay using the reference shown.",
      planType,
      amountExpected: expectedAmount,
      paymentReference,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to create subscription request." },
      { status: 500 }
    );
  }
}