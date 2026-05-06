import { NextResponse } from "next/server";
import { type SupabaseClient } from "@supabase/supabase-js";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  getDriverSubscriptionAmount,
  getDriverSubscriptionDays,
  isDriverSubscriptionPlan,
  type DriverSubscriptionPlan,
} from "@/lib/finance/driverPayments";
import { sendPushSafe } from "@/lib/push-server";

type PaymentType = "subscription" | "commission" | "combined";

type PaymentRequestRecord = {
  id: string;
  driver_id: string;
  payment_type: string | null;
  subscription_plan: string | null;
  amount_expected: number | null;
  amount_submitted: number | null;
  payment_reference: string | null;
  note: string | null;
  pop_file_path: string | null;
  pop_file_url: string | null;
  status: string | null;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
};

type DriverRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  subscription_expires_at?: string | null;
  subscription_amount_due?: number | null;
};

type DriverWalletRecord = {
  id: string;
  balance_due: number | null;
};

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function addDays(base: Date, days: number) {
  const copy = new Date(base);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function isPaymentType(value: string): value is PaymentType {
  return value === "subscription" || value === "commission" || value === "combined";
}

function extractPaymentProofPath(url: string | null) {
  if (!url) return null;
  const marker = "/storage/v1/object/public/payment-proofs/";
  const index = url.indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(url.slice(index + marker.length));
}

async function createPaymentProofSignedUrl(
  supabaseAdmin: SupabaseClient,
  row: PaymentRequestRecord,
) {
  const path = row.pop_file_path || extractPaymentProofPath(row.pop_file_url);
  if (!path) return null;

  const { data, error } = await supabaseAdmin.storage
    .from("payment-proofs")
    .createSignedUrl(path, 60 * 10);

  if (error) return null;
  return data.signedUrl;
}

async function notifyDriverPaymentReview(
  supabaseAdmin: SupabaseClient,
  driverId: string,
  title: string,
  body: string,
) {
  const { data: account } = await supabaseAdmin
    .from("driver_accounts")
    .select("user_id")
    .eq("driver_id", driverId)
    .maybeSingle();

  const userId = account?.user_id ? String(account.user_id) : "";
  if (!userId) return;

  await sendPushSafe({
    userIds: [userId],
    role: "driver",
    title,
    body,
    url: "/driver/earnings",
  });
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

    const paymentRows = (rows ?? []) as PaymentRequestRecord[];
    const driverIds = Array.from(new Set(paymentRows.map((row) => row.driver_id)));
    const { data: drivers } = await supabaseAdmin
      .from("drivers")
      .select("id,first_name,last_name,phone")
      .in("id", driverIds.length ? driverIds : ["00000000-0000-0000-0000-000000000000"]);

    const driverNameById = new Map<string, { name: string; phone: string | null }>();
    for (const d of (drivers ?? []) as DriverRecord[]) {
      const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || d.id;
      driverNameById.set(d.id, {
        name,
        phone: d.phone ?? null,
      });
    }

    const decorated = await Promise.all(
      paymentRows.map(async (row) => ({
        ...row,
        pop_file_url: (await createPaymentProofSignedUrl(supabaseAdmin, row)) ?? row.pop_file_url,
        driver_name: driverNameById.get(row.driver_id)?.name ?? row.driver_id,
        driver_phone: driverNameById.get(row.driver_id)?.phone ?? null,
      }))
    );

    return NextResponse.json({
      ok: true,
      requests: decorated,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load payment reviews." },
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
    const body = await req.json().catch(() => null);

    const requestId = String(body && typeof body === "object" && "requestId" in body ? body.requestId : "").trim();
    const action = String(body && typeof body === "object" && "action" in body ? body.action : "").trim();
    const reviewNote = String(body && typeof body === "object" && "reviewNote" in body ? body.reviewNote : "").trim();

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

      await notifyDriverPaymentReview(
        supabaseAdmin,
        String(paymentRequest.driver_id),
        "Payment rejected",
        "Your MOOVU payment proof was rejected. Check the review note and submit again if needed.",
      );

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

      await notifyDriverPaymentReview(
        supabaseAdmin,
        String(paymentRequest.driver_id),
        "Payment still under review",
        "MOOVU marked your payment proof as waiting for confirmation.",
      );

      return NextResponse.json({
        ok: true,
        message: "Payment request marked as still waiting.",
      });
    }

    const driverId = String(paymentRequest.driver_id);
    const paymentTypeRaw = String(paymentRequest.payment_type ?? "");
    if (!isPaymentType(paymentTypeRaw)) {
      return NextResponse.json({ ok: false, error: "Payment request has an invalid payment type." }, { status: 400 });
    }

    const paymentType = paymentTypeRaw;
    const subscriptionPlanRaw = String(paymentRequest.subscription_plan ?? "");
    const subscriptionPlan: DriverSubscriptionPlan | null = isDriverSubscriptionPlan(subscriptionPlanRaw)
      ? subscriptionPlanRaw
      : null;
    const amountSubmitted = num(paymentRequest.amount_submitted);
    const reference = String(paymentRequest.payment_reference ?? "").trim();
    const note = String(paymentRequest.note ?? "").trim();

    if (amountSubmitted <= 0) {
      return NextResponse.json(
        { ok: false, error: "Submitted amount must be greater than R0.00." },
        { status: 400 },
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

    const driverRecord = driver as DriverRecord | null;

    if (driverError || !driverRecord) {
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

    const walletRecord = wallet as DriverWalletRecord | null;
    const currentCommissionDue = num(walletRecord?.balance_due);
    const currentSubscriptionDue = num(driverRecord.subscription_amount_due);
    const selectedSubscriptionAmount = subscriptionPlan
      ? getDriverSubscriptionAmount(subscriptionPlan)
      : currentSubscriptionDue;

    let commissionPaid = 0;
    let subscriptionPaid = 0;

    if (paymentType === "subscription") {
      subscriptionPaid = amountSubmitted;
    } else if (paymentType === "commission") {
      commissionPaid = Math.min(currentCommissionDue, amountSubmitted);
    } else {
      subscriptionPaid = selectedSubscriptionAmount;
      commissionPaid = Math.min(currentCommissionDue, Math.max(0, amountSubmitted - subscriptionPaid));
    }

    if (paymentType === "commission" && commissionPaid <= 0) {
      return NextResponse.json(
        { ok: false, error: "This driver does not currently have commission owed." },
        { status: 400 },
      );
    }

    if ((paymentType === "subscription" || paymentType === "combined") && !subscriptionPlan) {
      return NextResponse.json(
        { ok: false, error: "A valid subscription plan is required for this payment." },
        { status: 400 },
      );
    }

    if ((paymentType === "subscription" || paymentType === "combined") && amountSubmitted + 0.009 < selectedSubscriptionAmount) {
      return NextResponse.json(
        { ok: false, error: `Submitted amount is below the ${subscriptionPlan} subscription amount of R${selectedSubscriptionAmount.toFixed(2)}.` },
        { status: 400 },
      );
    }

    if (paymentType === "subscription" || paymentType === "combined") {
      const now = new Date();
      const currentExpiry =
        driverRecord.subscription_expires_at && new Date(driverRecord.subscription_expires_at).getTime() > now.getTime()
          ? new Date(driverRecord.subscription_expires_at)
          : now;

      const days = subscriptionPlan ? getDriverSubscriptionDays(subscriptionPlan) : 0;
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
      let walletId = walletRecord?.id ?? null;

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

    await notifyDriverPaymentReview(
      supabaseAdmin,
      driverId,
      "Payment approved",
      "Your MOOVU payment proof was approved.",
    );

    return NextResponse.json({
      ok: true,
      message: "Payment approved successfully.",
      applied: {
        paymentType,
        subscriptionPaid,
        commissionPaid,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to review payment." },
      { status: 500 }
    );
  }
}
