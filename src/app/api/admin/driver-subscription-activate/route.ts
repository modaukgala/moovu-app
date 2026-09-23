import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";

type Result = { plan: string; amount_applied: number; unapplied_excess: number; expires_at: string; replayed: boolean };

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    if (!isFinancialAdminRole(auth.profile.role)) {
      return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
    }
    const body = await req.json().catch(() => null);
    const driverId = String(body?.driverId ?? "").trim();
    const operationKey = String(body?.operationKey ?? "").trim();
    const plan = String(body?.planType ?? "").trim().toLowerCase();
    const amount = Number(body?.amountPaid ?? 0);
    if (!driverId) return NextResponse.json({ ok: false, error: "Driver ID is required." }, { status: 400 });
    if (!operationKey) return NextResponse.json({ ok: false, error: "Stable operation key is required." }, { status: 400 });
    if (!["day", "week", "month"].includes(plan)) return NextResponse.json({ ok: false, error: "Valid plan type is required." }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ ok: false, error: "Amount paid must be greater than zero." }, { status: 400 });
    const result = await callHardenedRpc<Result>(auth.supabaseAdmin, "phase05b_activate_subscription", {
      p_operation_key: `subscription-activation:${operationKey}`, p_driver_id: driverId, p_plan: plan, p_amount: amount,
      p_method: String(body?.paymentMethod ?? "eft").trim() || "eft",
      p_reference: String(body?.reference ?? "").trim() || null, p_note: String(body?.note ?? "").trim() || null,
      p_request_id: String(body?.requestId ?? "").trim() || null, p_actor_id: auth.user.id,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ ok: true, replayed: result.result.replayed,
      message: result.result.replayed ? "This subscription activation was already applied." : "Subscription activated successfully.",
      subscription_status: "active", subscription_plan: result.result.plan, subscription_expires_at: result.result.expires_at,
      subscription_amount_due: 0, subscription_last_payment_amount: result.result.amount_applied,
      unapplied_excess: result.result.unapplied_excess });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error." }, { status: 500 });
  }
}
