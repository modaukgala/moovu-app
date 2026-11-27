import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { isRefundReason, payoutRpcError, rand, REFUND_REASONS } from "@/lib/finance/payoutsV2";
import { NO_STORE } from "@/lib/finance/payoutsV2Server";
import { sendPushSafe } from "@/lib/push-server";

const tripIdOk = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

/** Refund status for one of the customer's trips: can they request one, and where does it stand? */
export async function GET(req: Request) {
  const auth = await getAuthenticatedCustomer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const tripId = new URL(req.url).searchParams.get("tripId") ?? "";
  if (!tripIdOk(tripId)) return NextResponse.json({ ok: false, error: "Invalid trip." }, { status: 400 });
  const db = auth.supabaseAdmin;
  const { data: trip } = await db.from("trips").select("id,status,customer_id,payment_method").eq("id", tripId).maybeSingle();
  if (!trip || trip.customer_id !== auth.customer.id) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  const existing = await db.from("customer_refund_requests")
    .select("id,status,amount_cents,requested_at,resolved_at,decline_reason")
    .eq("trip_id", tripId).order("requested_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.error) return NextResponse.json({ ok: true, eligible: false, request: null }, { headers: NO_STORE });
  const { data: payment } = await db.from("online_payment_attempts").select("id,state,amount_cents")
    .eq("trip_id", tripId).in("state", ["SUCCEEDED", "REFUNDED"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const open = existing.data && existing.data.status !== "DECLINED";
  const eligible = trip.status === "cancelled" && payment?.state === "SUCCEEDED" && !open;
  return NextResponse.json({ ok: true, eligible, amountCents: payment?.amount_cents ?? null,
    alreadyRefunded: payment?.state === "REFUNDED", request: existing.data ?? null }, { headers: NO_STORE });
}

/** { tripId, reason: NO_DRIVER | DRIVER_CANCELLED | OTHER, note? } */
export async function POST(req: Request) {
  const auth = await getAuthenticatedCustomer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const tripId = String(body?.tripId ?? "");
  if (!tripIdOk(tripId)) return NextResponse.json({ ok: false, error: "Invalid trip." }, { status: 400 });
  if (!isRefundReason(body?.reason)) return NextResponse.json({ ok: false, error: "Choose a reason." }, { status: 400 });
  const note = String(body?.note ?? "").trim().slice(0, 500);
  const { data, error } = await auth.supabaseAdmin.rpc("moovu_request_customer_refund", {
    p_trip_id: tripId, p_customer_id: auth.customer.id, p_reason: body.reason, p_note: note || null,
  });
  if (error) {
    const mapped = payoutRpcError(error);
    return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
  }
  const row = data as { id: string; amount_cents: number; replayed?: boolean };
  if (!row.replayed) {
    await sendPushSafe({
      role: "admin",
      title: "Refund requested",
      body: `A customer asked for a ${rand(row.amount_cents)} refund (${REFUND_REASONS[body.reason]}).`,
      url: "/admin/refunds",
      data: { type: "customer_refund_requested", requestId: row.id },
      notificationEventKey: `customer-refund-requested:${row.id}`,
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, request: row }, { headers: NO_STORE });
}
