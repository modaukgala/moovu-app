import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { payoutRpcError, rand } from "@/lib/finance/payoutsV2";
import { NO_STORE } from "@/lib/finance/payoutsV2Server";
import { sendPushSafe } from "@/lib/push-server";

async function financialAdmin(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return { ok: false as const, res: NextResponse.json({ ok: false, error: auth.error }, { status: auth.status }) };
  if (!isFinancialAdminRole(auth.profile.role)) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 }) };
  }
  return { ok: true as const, auth };
}

/** Open payout requests first, then the latest paid/cancelled ones. */
export async function GET(req: Request) {
  const gate = await financialAdmin(req);
  if (!gate.ok) return gate.res;
  const db = gate.auth.supabaseAdmin;
  const { data, error } = await db.from("driver_payout_requests")
    .select("id,driver_id,status,card_earnings_cents,debt_recovered_cents,net_cents,payout_details,method,reference,requested_at,paid_at,cancel_reason")
    .order("requested_at", { ascending: false }).limit(100);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json({ ok: true, active: false, requests: [] }, { headers: NO_STORE });
    }
    return NextResponse.json({ ok: false, error: "Payout requests are unavailable." }, { status: 503 });
  }
  const ids = [...new Set((data ?? []).map(row => row.driver_id))];
  const { data: drivers } = ids.length
    ? await db.from("drivers").select("id,first_name,last_name,phone").in("id", ids)
    : { data: [] as { id: string; first_name: string | null; last_name: string | null; phone: string | null }[] };
  const byId = new Map((drivers ?? []).map(d => [d.id, d]));
  const requests = (data ?? []).map(row => {
    const d = byId.get(row.driver_id);
    return { ...row, driver_name: [d?.first_name, d?.last_name].filter(Boolean).join(" ") || "Driver", driver_phone: d?.phone ?? null };
  }).sort((a, b) => Number(b.status === "REQUESTED") - Number(a.status === "REQUESTED"));
  return NextResponse.json({ ok: true, active: true, requests }, { headers: NO_STORE });
}

/** { action: "paid", requestId, reference, paidAt? } or { action: "cancel", requestId, reason } */
export async function POST(req: Request) {
  const gate = await financialAdmin(req);
  if (!gate.ok) return gate.res;
  const db = gate.auth.supabaseAdmin;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const requestId = String(body?.requestId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const adminId = gate.auth.user.id;
  const result = body?.action === "paid"
    ? await db.rpc("moovu_mark_driver_payout_paid", {
        p_request_id: requestId, p_admin_id: adminId,
        p_reference: String(body?.reference ?? ""),
        p_paid_at: body?.paidAt ? new Date(String(body.paidAt)).toISOString() : null })
    : body?.action === "cancel"
      ? await db.rpc("moovu_cancel_driver_payout", { p_request_id: requestId, p_admin_id: adminId, p_reason: String(body?.reason ?? "") })
      : null;
  if (!result) return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  if (result.error) {
    const mapped = payoutRpcError(result.error);
    return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
  }
  const row = result.data as { id: string; driver_id: string; net_cents: number; status: string };
  const { data: account } = await db.from("driver_accounts").select("user_id").eq("driver_id", row.driver_id).maybeSingle();
  if (account?.user_id) {
    const paid = row.status === "PAID";
    await sendPushSafe({
      userIds: [account.user_id],
      role: "driver",
      title: paid ? "Payout sent" : "Payout request cancelled",
      body: paid ? `MOOVU sent you ${rand(row.net_cents)}.` : "Your payout request was cancelled. You can request again.",
      url: "/driver/earnings",
      data: { type: paid ? "driver_payout_paid" : "driver_payout_cancelled", requestId: row.id },
      notificationEventKey: `driver-payout-${paid ? "paid" : "cancelled"}:${row.id}`,
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, request: row }, { headers: NO_STORE });
}
