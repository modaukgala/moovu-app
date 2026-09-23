import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";

type Result = { subscription_amount_due: number; replayed: boolean };

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
    const amountPaid = Number(body?.amountPaid ?? 0);
    if (!driverId) return NextResponse.json({ ok: false, error: "Driver ID is required." }, { status: 400 });
    if (!operationKey) return NextResponse.json({ ok: false, error: "Stable operation key is required." }, { status: 400 });
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) return NextResponse.json({ ok: false, error: "Amount paid must be greater than zero." }, { status: 400 });
    const result = await callHardenedRpc<Result>(auth.supabaseAdmin, "phase05b_record_subscription_payment", {
      p_operation_key: `subscription-payment:${operationKey}`, p_driver_id: driverId, p_amount: amountPaid,
      p_method: String(body?.paymentMethod ?? "eft").trim() || "eft",
      p_reference: String(body?.reference ?? "").trim() || null, p_note: String(body?.note ?? "").trim() || null,
      p_actor_id: auth.user.id,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ ok: true, replayed: result.result.replayed,
      message: result.result.replayed ? "This subscription payment was already recorded." : "Subscription payment recorded successfully.",
      subscriptionAmountDue: result.result.subscription_amount_due });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error." }, { status: 500 });
  }
}
