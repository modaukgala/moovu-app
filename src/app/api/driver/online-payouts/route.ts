import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { optionBEffectiveAt, payoutActivationMatches, payoutEffectiveAt, payoutVisibilityAvailable } from "@/lib/finance/onlinePayoutAvailability";
import { loadUnpostedOnlineEarnings } from "@/lib/finance/onlineEarningReadModel";

export async function GET(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: account, error: accountError } = await admin.from("driver_accounts")
    .select("driver_id").eq("user_id", user.id).maybeSingle();
  if (accountError || !account?.driver_id) {
    return NextResponse.json({ ok: false, error: "Driver account is not linked." }, { status: 403 });
  }
  if (!payoutVisibilityAvailable()) {
    return NextResponse.json({ ok: true, available: false, batches: [] },
      { headers: { "Cache-Control": "private, no-store" } });
  }
  const cutoff = payoutEffectiveAt();
  const policy = await admin.from("online_payout_policy")
    .select("effective_at").eq("policy_key", "manual-online-payouts").single();
  if (policy.error) return NextResponse.json({ ok: false, error: "Payout activation state is unavailable." }, { status: 503 });
  const activated = payoutActivationMatches(cutoff, policy.data.effective_at);
  const optionBConfigured = optionBEffectiveAt();
  let optionBCutoff: string | null = null;
  if (optionBConfigured) {
    const optionBPolicy = await admin.from("online_payout_policy")
      .select("option_b_effective_at").eq("policy_key", "manual-online-payouts").single();
    if (optionBPolicy.error || !payoutActivationMatches(optionBConfigured, optionBPolicy.data.option_b_effective_at)) {
      return NextResponse.json({ ok: false, error: "Option B activation state is unavailable." }, { status: 503 });
    }
    optionBCutoff = optionBConfigured;
  }
  let pendingEarnings: Awaited<ReturnType<typeof loadUnpostedOnlineEarnings>> = [];
  if (activated && cutoff) {
    try { pendingEarnings = await loadUnpostedOnlineEarnings(admin, cutoff, optionBCutoff, account.driver_id); }
    catch { return NextResponse.json({ ok: false, error: "Completed trip earnings are unavailable." }, { status: 503 }); }
  }
  const { data, error } = await admin.from("online_payout_batches")
    .select("id,period_start,period_end,status,fare_cents,current_commission_cents,driver_earnings_cents,actual_provider_fee_cents,driver_provider_fee_cents,prior_debt_recovery_cents,net_payout_cents,policy_version,driver_booking_share_cents,approved_snapshot,payout_method,approved_at,paid_at,created_at")
    .eq("driver_id", account.driver_id).order("created_at", { ascending: false }).limit(50);
  if (error) {
    console.error("[driver-online-payouts] read failed", { code: error.code });
    return NextResponse.json({ ok: false, error: "Online payouts are unavailable." }, { status: 503 });
  }
  const batchIds = (data ?? []).map(row => row.id);
  const eligible = await admin.from("online_driver_payables")
    .select("id,driver_id,trip_id,fare_cents,commission_cents,payable_cents,earned_at,state,payment_attempt_id")
    .eq("driver_id", account.driver_id).in("state", ["EARNED", "PAYABLE"])
    .gte("earned_at", cutoff ?? "9999-12-31T00:00:00Z")
    .order("earned_at", { ascending: false }).limit(100);
  if (eligible.error) return NextResponse.json({ ok: false, error: "Eligible trip list is unavailable." }, { status: 503 });
  const payableIds = (eligible.data ?? []).map(row => row.id);
  const alreadyBatched = payableIds.length ? await admin.from("online_payout_items")
    .select("payable_id").in("payable_id", payableIds) : { data: [], error: null };
  if (alreadyBatched.error) return NextResponse.json({ ok: false, error: "Payout selection is unavailable." }, { status: 503 });
  const attemptIds = (eligible.data ?? []).map(row => row.payment_attempt_id);
  const feeEvidence = attemptIds.length ? await admin.from("online_payout_fee_evidence")
    .select("payment_attempt_id,percentage_fee_cents,fixed_fee_cents,actual_fee_cents").in("payment_attempt_id", attemptIds) : { data: [], error: null };
  if (feeEvidence.error) return NextResponse.json({ ok: false, error: "Verified fee status is unavailable." }, { status: 503 });
  const manualPayments = batchIds.length > 0 ? await admin.from("online_payout_manual_payments")
    .select("id,batch_id,amount_cents,payment_at,method,bank_reference,state,recorded_at,verified_at")
    .in("batch_id", batchIds).order("recorded_at", { ascending: true })
    : { data: [], error: null };
  if (manualPayments.error) {
    return NextResponse.json({ ok: false, error: "Payment history is unavailable." }, { status: 503 });
  }
  const items = batchIds.length > 0 ? await admin.from("online_payout_items")
    .select("batch_id,id,payable_id,percentage_fee_cents,fixed_fee_cents,driver_percentage_fee_cents,moovu_percentage_fee_cents").in("batch_id", batchIds).limit(1000) : { data: [], error: null };
  if (items.error || (items.data ?? []).length === 1000) {
    return NextResponse.json({ ok: false, error: "Payout trip counts are unavailable." }, { status: 503 });
  }
  const itemPayableIds = [...new Set((items.data ?? []).map(item => item.payable_id))];
  const itemPayables = itemPayableIds.length ? await admin.from("online_driver_payables")
    .select("id,trip_id").in("id", itemPayableIds) : { data: [], error: null };
  if (itemPayables.error || (itemPayables.data ?? []).length !== itemPayableIds.length)
    return NextResponse.json({ ok: false, error: "Payout basis is unavailable." }, { status: 503 });
  const tripIds = [...new Set([...(eligible.data ?? []).map(row => row.trip_id),
    ...(itemPayables.data ?? []).map(row => row.trip_id)])];
  const trips = tripIds.length ? await admin.from("trips")
    .select("id,phase5_service_fee_cents").in("id", tripIds) : { data: [], error: null };
  if (trips.error || (trips.data ?? []).length !== tripIds.length)
    return NextResponse.json({ ok: false, error: "Booking fee basis is unavailable." }, { status: 503 });
  const feeByTrip = new Map((trips.data ?? []).map(row => [row.id, Number(row.phase5_service_fee_cents ?? 0)]));
  const tripByPayable = new Map((itemPayables.data ?? []).map(row => [row.id, row.trip_id]));
  const bookingFeeByBatch = Object.fromEntries((data ?? []).map(batch => [batch.id,
    (items.data ?? []).filter(item => item.batch_id === batch.id)
      .reduce((sum, item) => sum + (feeByTrip.get(tripByPayable.get(item.payable_id) ?? "") ?? 0), 0)]));
  const { data: financePosition, error: financeError } = await admin.rpc("phase2_driver_finance_position", {
    p_driver_id: account.driver_id,
  });
  if (financeError) {
    console.error("[driver-online-payouts] finance position failed", { code: financeError.code });
    return NextResponse.json({ ok: false, error: "Commission balance is unavailable." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, available: true, activated, batches: data ?? [],
    pendingEarnings,
    eligiblePayables: (eligible.data ?? []).filter(row =>
      !(alreadyBatched.data ?? []).some(item => item.payable_id === row.id))
      .map(row => ({ ...row, booking_fee_cents: feeByTrip.get(row.trip_id) ?? 0 })),
    bookingFeeByBatch,
    verifiedFeeAttemptIds: (feeEvidence.data ?? []).filter(row => {
      if (!optionBCutoff) return true;
      const payable = (eligible.data ?? []).find(item => item.payment_attempt_id === row.payment_attempt_id);
      if (!payable || Date.parse(payable.earned_at) < Date.parse(optionBCutoff)) return true;
      return row.percentage_fee_cents !== null && row.fixed_fee_cents !== null &&
        row.percentage_fee_cents + row.fixed_fee_cents === row.actual_fee_cents;
    }).map(row => row.payment_attempt_id),
    manualPayments: manualPayments.data ?? [], items: items.data ?? [],
    remainingCommissionDebtCents: Number(financePosition?.commission_debt_cents ?? 0) },
    { headers: { "Cache-Control": "private, no-store" } });
}
