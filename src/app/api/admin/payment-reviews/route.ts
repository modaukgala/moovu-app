import { NextResponse } from "next/server";
import { type SupabaseClient } from "@supabase/supabase-js";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { sendPushSafe } from "@/lib/push-server";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";
import { callPhase2Rpc } from "@/lib/server/phase2Rpc";
import { phase2Mode } from "@/lib/finance/phase2Policy";
import { isOutboxDeliveryEnabled } from "@/lib/notifications/outboxDelivery";

type PaymentRequestRecord = {
  id: string; driver_id: string; payment_type: string | null; subscription_plan: string | null;
  amount_expected: number | null; amount_submitted: number | null; payment_reference: string | null;
  note: string | null; pop_file_path: string | null; pop_file_url: string | null; status: string | null;
  review_note: string | null; submitted_at: string | null; reviewed_at: string | null;
};
type DriverRecord = { id: string; first_name: string | null; last_name: string | null; phone: string | null };
type PaymentReviewResult = {
  request_id: string; driver_id: string; status: string; payment_type: string | null;
  subscription_applied: number; commission_applied: number; unapplied_excess: number; replayed: boolean;
};
type Phase2PaymentPostingResult = {
  posting_outcome: "POSTED" | "PRE_CUTOFF_SKIPPED";
  posted: boolean;
  replayed: boolean;
  applied_cents: number;
  unapplied_cents: number;
};

function extractPaymentProofPath(url: string | null) {
  if (!url) return null;
  const marker = "/storage/v1/object/public/payment-proofs/";
  const index = url.indexOf(marker);
  return index < 0 ? null : decodeURIComponent(url.slice(index + marker.length));
}

async function createPaymentProofSignedUrl(supabaseAdmin: SupabaseClient, row: PaymentRequestRecord) {
  const path = row.pop_file_path || extractPaymentProofPath(row.pop_file_url);
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage.from("payment-proofs").createSignedUrl(path, 60 * 10);
  return error ? null : data.signedUrl;
}

async function notifyDriverPaymentReview(
  supabaseAdmin: SupabaseClient, driverId: string, title: string, body: string, url: string,
) {
  const { data: account } = await supabaseAdmin.from("driver_accounts").select("user_id")
    .eq("driver_id", driverId).maybeSingle();
  if (!account?.user_id) return;
  await sendPushSafe({ userIds: [String(account.user_id)], role: "driver", title, body, url });
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    const url = new URL(req.url);
    const status = String(url.searchParams.get("status") ?? "pending_payment_review").trim();
    let query = auth.supabaseAdmin.from("driver_payment_requests").select(`
      id,driver_id,payment_type,subscription_plan,amount_expected,amount_submitted,payment_reference,
      note,pop_file_path,pop_file_url,status,review_note,submitted_at,reviewed_at
    `).order("submitted_at", { ascending: false });
    if (status !== "all") query = query.eq("status", status);
    const { data: rows, error } = await query;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const paymentRows = (rows ?? []) as PaymentRequestRecord[];
    const driverIds = Array.from(new Set(paymentRows.map((row) => row.driver_id)));
    const { data: drivers } = await auth.supabaseAdmin.from("drivers").select("id,first_name,last_name,phone")
      .in("id", driverIds.length ? driverIds : ["00000000-0000-0000-0000-000000000000"]);
    const driverById = new Map<string, { name: string; phone: string | null }>();
    for (const driver of (drivers ?? []) as DriverRecord[]) {
      driverById.set(driver.id, {
        name: `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || driver.id,
        phone: driver.phone,
      });
    }
    const decorated = await Promise.all(paymentRows.map(async (row) => ({
      ...row,
      pop_file_url: (await createPaymentProofSignedUrl(auth.supabaseAdmin, row)) ?? row.pop_file_url,
      driver_name: driverById.get(row.driver_id)?.name ?? "Driver profile unavailable",
      driver_phone: driverById.get(row.driver_id)?.phone ?? null,
    })));
    return NextResponse.json({ ok: true, requests: decorated });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to load payment reviews." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    if (!isFinancialAdminRole(auth.profile.role)) {
      return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
    }
    const body = await req.json().catch(() => null);
    const requestId = String(body?.requestId ?? "").trim();
    const action = String(body?.action ?? "").trim();
    const reviewNote = String(body?.reviewNote ?? "").trim().slice(0, 500);
    if (!requestId) return NextResponse.json({ ok: false, error: "Request ID is required." }, { status: 400 });
    if (!["approve", "reject", "waiting"].includes(action)) {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    const financeMode = phase2Mode();
    const mutation = await callHardenedRpc<PaymentReviewResult>(auth.supabaseAdmin,
      financeMode === "AUTHORITATIVE" ? "phase2_review_driver_payment" : "phase05b_review_driver_payment", {
      p_request_id: requestId, p_action: action, p_review_note: reviewNote || null, p_actor_id: auth.user.id,
    });
    if (!mutation.ok) {
      console.error("[payment-review] hardened contract rejected operation", { requestId, action, code: mutation.code });
      return NextResponse.json({ ok: false, error: mutation.error, code: mutation.code }, { status: mutation.status });
    }

    const result = mutation.result;
    // Legacy replay can recover a shadow post missed after the approval committed.
    if (result.status === "approved" && financeMode === "SHADOW" &&
      (result.commission_applied > 0 || result.unapplied_excess > 0)) {
      const sourceKey = `driver_payment:${requestId}`;
      try {
        const shadow = await callPhase2Rpc<Phase2PaymentPostingResult>(auth.supabaseAdmin, "phase2_post_verified_driver_payment", {
          p_request_id: requestId,
          p_actor_id: auth.user.id,
        });
        if (!shadow.ok) {
          console.error("[phase2-finance] shadow payment posting requires reconciliation", {
            requestId,
            sourceKey,
            legacyReplayed: result.replayed,
            state: "unresolved",
            code: shadow.code,
          });
        } else if (shadow.result.posting_outcome === "PRE_CUTOFF_SKIPPED") {
          console.info("[phase2-finance] historical shadow payment deterministically skipped", {
            requestId, sourceKey, state: "resolved", legacyReplayed: result.replayed,
            shadowReplayed: shadow.result.replayed === true,
          });
        } else {
          console.info("[phase2-finance] shadow payment posting reconciled", {
            requestId, sourceKey, state: "resolved", legacyReplayed: result.replayed,
            shadowReplayed: shadow.result.replayed === true,
          });
        }
      } catch {
        console.error("[phase2-finance] shadow payment posting requires reconciliation", {
          requestId, sourceKey, state: "unresolved", legacyReplayed: result.replayed,
          code: "transport_failure",
        });
      }
    }
    const title = result.status === "approved"
      ? result.payment_type === "subscription" ? "Subscription payment approved" : "Commission payment approved"
      : result.status === "rejected" ? "Payment rejected" : "Payment still under review";
    const message = result.status === "approved"
      ? "Your MOOVU payment was approved and the verified amount was applied."
      : result.status === "rejected"
        ? "Your MOOVU payment proof was rejected. Check the review note before submitting a new request."
        : "MOOVU marked your payment proof as waiting for confirmation.";
    if (!result.replayed && !isOutboxDeliveryEnabled()) {
      await notifyDriverPaymentReview(auth.supabaseAdmin, result.driver_id, title, message, `/driver/payment-receipts/${requestId}`)
        .catch(() => console.warn("[payment-review] post-commit notification deferred", { requestId }));
    }
    return NextResponse.json({
      ok: true,
      message: result.replayed ? "Payment review already has this authoritative result." : "Payment review saved.",
      replayed: result.replayed,
      applied: {
        paymentType: result.payment_type,
        subscriptionPaid: result.subscription_applied,
        commissionPaid: result.commission_applied,
        unappliedExcess: result.unapplied_excess,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to review payment." }, { status: 500 });
  }
}
