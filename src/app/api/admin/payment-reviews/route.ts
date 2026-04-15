import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

const PLAN_DAYS = {
  day: 1,
  week: 7,
  month: 30,
} as const;

type PlanType = keyof typeof PLAN_DAYS;

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function addDays(base: Date, days: number) {
  const copy = new Date(base);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;
    const url = new URL(req.url);
    const status = String(url.searchParams.get("status") ?? "pending_payment_review").trim();

    let query = supabaseAdmin
      .from("driver_payment_requests")
      .select(`
        id,
        driver_id,
        payment_type,
        subscription_plan,
        amount_expected,
        amount_submitted,
        payment_reference,
        note,
        pop_file_path,
        pop_file_url,
        status,
        review_note,
        submitted_at,
        reviewed_at
      `)
      .order("submitted_at", { ascending: false });

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data: rows, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const driverIds = Array.from(new Set((rows ?? []).map((r: any) => r.driver_id)));
    const { data: drivers } = await supabaseAdmin
      .from("drivers")
      .select("id,first_name,last_name,phone")
      .in("id", driverIds.length ? driverIds : ["00000000-0000-0000-0000-000000000000"]);

    const driverNameById = new Map<string, { name: string; phone: string | null }>();
    for (const d of drivers ?? []) {
      const name = `${(d as any).first_name ?? ""} ${(d as any).last_name ?? ""}`.trim() || (d as any).id;
      driverNameById.set((d as any).id, {
        name,
        phone: (d as any).phone ?? null,
      });
    }

    const decorated = (rows ?? []).map((row: any) => ({
      ...row,
      driver_name: driverNameById.get(row.driver_id)?.name ?? row.driver_id,
      driver_phone: driverNameById.get(row.driver_id)?.phone ?? null,
    }));

    return NextResponse.json({
      ok: true,
      requests: decorated,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load payment reviews." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin, user } = auth;
    const body = await req.json();

    const requestId = String(body?.requestId ?? "").trim();
    const action = String(body?.action ?? "").trim();
    const reviewNote = String(body?.reviewNote ?? "").trim();

    if (!requestId) {
      return NextResponse.json({ ok: false, error: "Request ID is required." }, { status: 400 });
    }

    if (!["approve", "reject", "waiting"].includes(action)) {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    const { data: paymentRequest, error: requestError } = await supabaseAdmin
      .from("driver_payment_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    if (requestError || !paymentRequest) {
      return NextResponse.json(
        { ok: false, error: requestError?.message || "Payment request not found." },
        { status: 404 }
      );
    }

    if (action === "reject") {
      const { error: rejectError } = await supabaseAdmin
        .from("driver_payment_requests")
        .update({
          status: "rejected",
          review_note: reviewNote || null,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq("id", requestId);

      if (rejectError) {
        return NextResponse.json({ ok: false, error: rejectError.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        message: "Payment request rejected.",
      });
    }

    if (action === "waiting") {
      const { error: waitingError } = await supabaseAdmin
        .from("driver_payment_requests")
        .update({
          status: "waiting_confirmation",
          review_note: reviewNote || null,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq("id", requestId);

      if (waitingError) {
        return NextResponse.json({ ok: false, error: waitingError.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        message: "Payment request marked as still waiting.",
      });
    }

    const driverId = String(paymentRequest.driver_id);
    const paymentType = String(paymentRequest.payment_type);
    const subscriptionPlan = paymentRequest.subscription_plan as PlanType | null;
    const amountSubmitted = num(paymentRequest.amount_submitted);
    const reference = String(paymentRequest.payment_reference ?? "").trim();
    const note = String(paymentRequest.note ?? "").trim();

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select(`
        id,
        subscription_expires_at,
        subscription_amount_due
      `)
      .eq("id", driverId)
      .maybeSingle();

    if (driverError || !driver) {
      return NextResponse.json(
        { ok: false, error: driverError?.message || "Driver not found." },
        { status: 404 }
      );
    }

    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("driver_wallets")
      .select("*")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (walletError) {
      return NextResponse.json({ ok: false, error: walletError.message }, { status: 500 });
    }

    const currentCommissionDue = num(wallet?.balance_due);
    const currentSubscriptionDue = num(driver.subscription_amount_due);

    let commissionPaid = 0;
    let subscriptionPaid = 0;

    if (paymentType === "subscription") {
      subscriptionPaid = amountSubmitted;
    } else if (paymentType === "commission") {
      commissionPaid = amountSubmitted;
    } else {
      subscriptionPaid = currentSubscriptionDue;
      commissionPaid = Math.max(0, amountSubmitted - subscriptionPaid);
    }

    if (paymentType === "subscription" || paymentType === "combined") {
      const now = new Date();
      const currentExpiry =
        driver.subscription_expires_at && new Date(driver.subscription_expires_at).getTime() > now.getTime()
          ? new Date(driver.subscription_expires_at)
          : now;

      const days = subscriptionPlan ? PLAN_DAYS[subscriptionPlan] : 0;
      const newExpiry = addDays(currentExpiry, days);

      const { error: paymentInsertError } = await supabaseAdmin
        .from("driver_subscription_payments")
        .insert({
          driver_id: driverId,
          amount_paid: subscriptionPaid,
          payment_method: "eft",
          reference: reference || null,
          note: note || null,
          received_by: user.id,
        });

      if (paymentInsertError) {
        return NextResponse.json({ ok: false, error: paymentInsertError.message }, { status: 500 });
      }

      const { error: subscriptionUpdateError } = await supabaseAdmin
        .from("drivers")
        .update({
          subscription_status: "active",
          subscription_plan: subscriptionPlan,
          subscription_expires_at: newExpiry.toISOString(),
          subscription_amount_due: 0,
          subscription_last_paid_at: new Date().toISOString(),
          subscription_last_payment_amount: subscriptionPaid,
          updated_at: new Date().toISOString(),
        })
        .eq("id", driverId);

      if (subscriptionUpdateError) {
        return NextResponse.json({ ok: false, error: subscriptionUpdateError.message }, { status: 500 });
      }
    }

    if (paymentType === "commission" || paymentType === "combined") {
      let walletId = wallet?.id ?? null;

      if (!walletId) {
        const { data: newWallet, error: createWalletError } = await supabaseAdmin
          .from("driver_wallets")
          .insert({
            driver_id: driverId,
            balance_due: currentCommissionDue,
            total_commission: 0,
            total_driver_net: 0,
            total_trips_completed: 0,
            updated_at: new Date().toISOString(),
          })
          .select("*")
          .single();

        if (createWalletError || !newWallet) {
          return NextResponse.json(
            { ok: false, error: createWalletError?.message || "Failed to create wallet." },
            { status: 500 }
          );
        }

        walletId = newWallet.id;
      }

      const { error: settlementInsertError } = await supabaseAdmin
        .from("driver_settlements")
        .insert({
          driver_id: driverId,
          wallet_id: walletId,
          amount_paid: commissionPaid,
          payment_method: "eft",
          reference: reference || null,
          note: note || null,
          received_by: user.id,
        });

      if (settlementInsertError) {
        return NextResponse.json({ ok: false, error: settlementInsertError.message }, { status: 500 });
      }

      const newBalanceDue = Math.max(0, currentCommissionDue - commissionPaid);

      const { error: walletUpdateError } = await supabaseAdmin
        .from("driver_wallets")
        .update({
          balance_due: newBalanceDue,
          last_payment_at: new Date().toISOString(),
          last_payment_amount: commissionPaid,
          account_status: newBalanceDue > 0 ? "due" : "settled",
          updated_at: new Date().toISOString(),
        })
        .eq("driver_id", driverId);

      if (walletUpdateError) {
        return NextResponse.json({ ok: false, error: walletUpdateError.message }, { status: 500 });
      }
    }

    const { error: approveError } = await supabaseAdmin
      .from("driver_payment_requests")
      .update({
        status: "approved",
        review_note: reviewNote || null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq("id", requestId);

    if (approveError) {
      return NextResponse.json({ ok: false, error: approveError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: "Payment approved successfully.",
      applied: {
        paymentType,
        subscriptionPaid,
        commissionPaid,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to review payment." },
      { status: 500 }
    );
  }
}