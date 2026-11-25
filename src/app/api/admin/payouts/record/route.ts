import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";

/** Records an EFT payout already made from the MOOVU bank account. */
export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) {
    return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const driverId = String(body?.driverId ?? "").trim();
  const amountCents = Math.round(Number(body?.amount ?? 0) * 100);
  if (!driverId) return NextResponse.json({ ok: false, error: "Driver is required." }, { status: 400 });
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return NextResponse.json({ ok: false, error: "Amount must be greater than zero." }, { status: 400 });
  }
  const { data, error } = await auth.supabaseAdmin.rpc("moovu_record_driver_payout", {
    p_driver_id: driverId, p_amount_cents: amountCents,
    p_reference: String(body?.reference ?? "").trim() || null,
    p_actor_id: auth.user.id, p_note: String(body?.note ?? "").trim() || null,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, result: data, message: "Payout recorded." });
}
