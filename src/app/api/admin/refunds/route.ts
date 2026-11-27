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

/** Refund requests with trip and customer details; open requests first. */
export async function GET(req: Request) {
  const gate = await financialAdmin(req);
  if (!gate.ok) return gate.res;
  const db = gate.auth.supabaseAdmin;
  const { data, error } = await db.from("customer_refund_requests")
    .select("id,trip_id,customer_id,amount_cents,reason,note,status,requested_at,resolved_at,reference,decline_reason")
    .order("requested_at", { ascending: false }).limit(100);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json({ ok: true, active: false, requests: [] }, { headers: NO_STORE });
    }
    return NextResponse.json({ ok: false, error: "Refund requests are unavailable." }, { status: 503 });
  }
  const tripIds = [...new Set((data ?? []).map(r => r.trip_id))];
  const customerIds = [...new Set((data ?? []).map(r => r.customer_id))];
  const [trips, customers] = await Promise.all([
    tripIds.length ? db.from("trips")
      .select("id,pickup_address,dropoff_address,created_at,cancelled_at,cancelled_by,cancellation_reason,driver_id")
      .in("id", tripIds) : Promise.resolve({ data: [] }),
    customerIds.length ? db.from("customers").select("id,first_name,last_name,phone").in("id", customerIds)
      : Promise.resolve({ data: [] }),
  ]);
  const tripById = new Map(((trips.data ?? []) as { id: string }[]).map(t => [t.id, t]));
  const customerById = new Map(((customers.data ?? []) as { id: string; first_name?: string; last_name?: string; phone?: string }[])
    .map(c => [c.id, c]));
  const requests = (data ?? []).map(r => {
    const c = customerById.get(r.customer_id);
    return {
      ...r,
      trip: tripById.get(r.trip_id) ?? null,
      customer_name: [c?.first_name, c?.last_name].filter(Boolean).join(" ") || "Customer",
      customer_phone: c?.phone ?? null,
    };
  }).sort((a, b) => Number(b.status === "REQUESTED") - Number(a.status === "REQUESTED"));
  return NextResponse.json({ ok: true, active: true, requests }, { headers: NO_STORE });
}

/** { action: "refunded", requestId, reference } or { action: "decline", requestId, reason } */
export async function POST(req: Request) {
  const gate = await financialAdmin(req);
  if (!gate.ok) return gate.res;
  const db = gate.auth.supabaseAdmin;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const requestId = String(body?.requestId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  if (body?.action !== "refunded" && body?.action !== "decline") {
    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }
  const refunded = body.action === "refunded";
  const { data, error } = await db.rpc("moovu_resolve_customer_refund", {
    p_request_id: requestId, p_admin_id: gate.auth.user.id, p_refunded: refunded,
    p_reference: String(body?.reference ?? ""), p_decline_reason: String(body?.reason ?? ""),
  });
  if (error) {
    const mapped = payoutRpcError(error);
    return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
  }
  const row = data as { id: string; trip_id: string; amount_cents: number; status: string };
  const { data: trip } = await db.from("trips").select("customer_auth_user_id").eq("id", row.trip_id).maybeSingle();
  if (trip?.customer_auth_user_id) {
    await sendPushSafe({
      userIds: [trip.customer_auth_user_id],
      role: "customer",
      title: refunded ? "Refund sent" : "Refund request update",
      body: refunded ? `MOOVU sent your ${rand(row.amount_cents)} refund.` : "MOOVU reviewed your refund request. Check the trip for details.",
      url: `/ride/${row.trip_id}`,
      data: { type: refunded ? "customer_refund_sent" : "customer_refund_declined", requestId: row.id },
      notificationEventKey: `customer-refund-${refunded ? "sent" : "declined"}:${row.id}`,
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, request: row }, { headers: NO_STORE });
}
