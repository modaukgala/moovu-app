import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";

type Result = { status: string; expires_at: string | null; replayed: boolean };

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
    const action = String(body?.action ?? "").trim();
    const days = body?.days == null ? null : Number(body.days);
    if (!driverId) return NextResponse.json({ ok: false, error: "Missing driverId" }, { status: 400 });
    if (!operationKey) return NextResponse.json({ ok: false, error: "Stable operation key is required." }, { status: 400 });
    if (!["activate", "suspend", "inactive", "grace", "extend", "set_expiry"].includes(action)) return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
    const result = await callHardenedRpc<Result>(auth.supabaseAdmin, "phase05b_update_subscription", {
      p_operation_key: `subscription-update:${operationKey}`, p_driver_id: driverId, p_action: action,
      p_days: Number.isFinite(days) ? days : null, p_note: body?.note ? String(body.note) : null,
      p_plan: body?.plan ? String(body.plan) : null, p_expiry: body?.expiry ? String(body.expiry) : null,
      p_actor_id: auth.user.id,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ ok: true, status: result.result.status, expires_at: result.result.expires_at, replayed: result.result.replayed });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
