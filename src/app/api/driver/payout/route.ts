import { NextResponse } from "next/server";
import { normalizePayoutDetails, payoutRpcError, rand } from "@/lib/finance/payoutsV2";
import { NO_STORE, requireDriver } from "@/lib/finance/payoutsV2Server";
import { sendPushSafe } from "@/lib/push-server";

/** Driver payout balance, saved payout details and recent payout requests. */
export async function GET(req: Request) {
  const auth = await requireDriver(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const [balance, details, history] = await Promise.all([
    auth.admin.rpc("moovu_driver_payout_balance", { p_driver_id: auth.driverId }),
    auth.admin.from("driver_payout_accounts")
      .select("payshap_id,bank_name,account_holder,account_number,branch_code,account_type")
      .eq("driver_id", auth.driverId).maybeSingle(),
    auth.admin.from("driver_payout_requests")
      .select("id,status,card_earnings_cents,debt_recovered_cents,net_cents,method,reference,requested_at,paid_at,cancel_reason")
      .eq("driver_id", auth.driverId).order("requested_at", { ascending: false }).limit(20),
  ]);
  // Before the payouts database step is applied, the function is missing: report "not active".
  if (balance.error) {
    if (balance.error.code === "PGRST202" || balance.error.code === "42883") {
      return NextResponse.json({ ok: true, balance: { active: false } }, { headers: NO_STORE });
    }
    return NextResponse.json({ ok: false, error: "Payouts are unavailable right now." }, { status: 503 });
  }
  const masked = details.data ? {
    ...details.data,
    account_number: details.data.account_number ? `•••• ${details.data.account_number.slice(-4)}` : "",
  } : null;
  const { payable_ids: _ids, ...publicBalance } = (balance.data ?? {}) as Record<string, unknown>;
  void _ids;
  return NextResponse.json({ ok: true, balance: publicBalance, details: masked, history: history.data ?? [] },
    { headers: NO_STORE });
}

/** Request a payout of everything currently available (minimum R50). */
export async function POST(req: Request) {
  const auth = await requireDriver(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const { data, error } = await auth.admin.rpc("moovu_request_driver_payout", { p_driver_id: auth.driverId });
  if (error) {
    const mapped = payoutRpcError(error);
    return NextResponse.json({ ok: false, code: mapped.code, error: mapped.message }, { status: mapped.status });
  }
  const row = data as { id: string; net_cents: number };
  const { data: driver } = await auth.admin.from("drivers").select("first_name,last_name").eq("id", auth.driverId).maybeSingle();
  const name = [driver?.first_name, driver?.last_name].filter(Boolean).join(" ") || "A driver";
  await sendPushSafe({
    role: "admin",
    title: "Payout requested",
    body: `${name} requested a payout of ${rand(row.net_cents)}.`,
    url: "/admin/online-payouts",
    data: { type: "driver_payout_requested", requestId: row.id },
    notificationEventKey: `driver-payout-requested:${row.id}`,
  }).catch(() => {});
  return NextResponse.json({ ok: true, request: row }, { headers: NO_STORE });
}

/** Save PayShap or bank details used for payouts. */
export async function PUT(req: Request) {
  const auth = await requireDriver(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const parsed = normalizePayoutDetails(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const { error } = await auth.admin.from("driver_payout_accounts").upsert({
    driver_id: auth.driverId,
    payshap_id: v.payshapId || null,
    bank_name: v.bankName,
    account_holder: v.accountHolder,
    account_number: v.accountNumber,
    branch_code: v.branchCode,
    account_type: v.accountType,
    verified_by_admin: false,
    updated_at: new Date().toISOString(),
  }, { onConflict: "driver_id" });
  if (error) {
    console.error("[driver-payout] details save failed", { code: error.code });
    return NextResponse.json({ ok: false, error: "Couldn't save your details. Please try again." }, { status: 503 });
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
