import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { bankVerificationAvailable, manualPayoutsAvailable, payoutActionAllowed, payoutVisibilityAvailable } from "@/lib/finance/onlinePayoutAvailability";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) {
    return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
  }
  if (!payoutVisibilityAvailable()) {
    return NextResponse.json({ ok: true, available: false, batches: [] },
      { headers: { "Cache-Control": "private, no-store" } });
  }
  const { data, error } = await auth.supabaseAdmin.from("online_payout_batches")
    .select("id,driver_id,period_start,period_end,status,hold_reason,fare_cents,current_commission_cents,driver_earnings_cents,actual_provider_fee_cents,driver_provider_fee_cents,prior_debt_recovery_cents,net_payout_cents,payout_method,transfer_reference,approved_at,transfer_recorded_at,paid_at,created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (error) {
    console.error("[admin-online-payouts] read failed", { code: error.code });
    return NextResponse.json({ ok: false, error: "Online payouts are unavailable." }, { status: 503 });
  }
  const batchIds = (data ?? []).map(row => row.id);
  const eligible = await auth.supabaseAdmin.from("online_driver_payables")
    .select("id,driver_id,trip_id,fare_cents,commission_cents,payable_cents,earned_at,state,payment_attempt_id")
    .in("state", ["EARNED", "PAYABLE"]).order("earned_at", { ascending: false }).limit(100);
  if (eligible.error) {
    return NextResponse.json({ ok: false, error: "Eligible trip list is unavailable." }, { status: 503 });
  }
  const eligibleAttemptIds = (eligible.data ?? []).map(row => row.payment_attempt_id);
  const eligiblePayableIds = (eligible.data ?? []).map(row => row.id);
  const alreadyBatched = eligiblePayableIds.length > 0 ? await auth.supabaseAdmin.from("online_payout_items")
    .select("payable_id").in("payable_id", eligiblePayableIds) : { data: [], error: null };
  if (alreadyBatched.error) {
    return NextResponse.json({ ok: false, error: "Payout selection is unavailable." }, { status: 503 });
  }
  const feeEvidence = eligibleAttemptIds.length > 0 ? await auth.supabaseAdmin.from("online_payout_fee_evidence")
    .select("payment_attempt_id").in("payment_attempt_id", eligibleAttemptIds) : { data: [], error: null };
  if (feeEvidence.error) {
    return NextResponse.json({ ok: false, error: "Verified fee status is unavailable." }, { status: 503 });
  }
  const driverIds = [...new Set((data ?? []).map(row => row.driver_id))];
  for (const row of eligible.data ?? []) driverIds.push(row.driver_id);
  const drivers = driverIds.length > 0 ? await auth.supabaseAdmin.from("drivers")
    .select("id,first_name,last_name").in("id", driverIds) : { data: [], error: null };
  if (drivers.error) {
    return NextResponse.json({ ok: false, error: "Driver identity is unavailable." }, { status: 503 });
  }
  const manualPayments = batchIds.length > 0 ? await auth.supabaseAdmin.from("online_payout_manual_payments")
    .select("id,batch_id,amount_cents,payment_at,method,bank_reference,proof_reference,state,recorded_at,verified_at")
    .in("batch_id", batchIds).order("recorded_at", { ascending: true }) : { data: [], error: null };
  if (manualPayments.error) {
    return NextResponse.json({ ok: false, error: "Manual payment history is unavailable." }, { status: 503 });
  }
  const paymentIds = (manualPayments.data ?? []).map(row => row.id);
  const manualEvidence = paymentIds.length > 0 ? await auth.supabaseAdmin.from("online_payout_manual_bank_evidence")
    .select("id,payment_id,bank_state,reviewed_at").in("payment_id", paymentIds)
    : { data: [], error: null };
  if (manualEvidence.error) {
    return NextResponse.json({ ok: false, error: "Bank review status is unavailable." }, { status: 503 });
  }
  const items = batchIds.length > 0 ? await auth.supabaseAdmin.from("online_payout_items")
    .select("batch_id,id").in("batch_id", batchIds) : { data: [], error: null };
  if (items.error) {
    return NextResponse.json({ ok: false, error: "Payout trip counts are unavailable." }, { status: 503 });
  }
  const evidence = batchIds.length > 0 ? await auth.supabaseAdmin.from("online_payout_bank_evidence")
    .select("id,batch_id,bank_transaction_reference,amount_cents,bank_state,source_type,imported_at,verified_at")
    .in("batch_id", batchIds) : { data: [], error: null };
  if (evidence.error) {
    console.error("[admin-online-payouts] bank evidence read failed", { code: evidence.error.code });
    return NextResponse.json({ ok: false, error: "Bank evidence is unavailable." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, available: true, recordingEnabled: manualPayoutsAvailable(),
    verificationEnabled: manualPayoutsAvailable() && bankVerificationAvailable(),
    batches: data ?? [], bankEvidence: evidence.data ?? [],
    manualPayments: manualPayments.data ?? [], manualEvidence: manualEvidence.data ?? [],
    drivers: drivers.data ?? [], items: items.data ?? [],
    eligiblePayables: (eligible.data ?? []).filter(row =>
      !(alreadyBatched.data ?? []).some(item => item.payable_id === row.id)),
    verifiedFeeAttemptIds: (feeEvidence.data ?? []).map(row => row.payment_attempt_id) },
    { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) {
    return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
  }
  if (!payoutVisibilityAvailable() || !manualPayoutsAvailable()) {
    return NextResponse.json({ ok: false, error: "Online payouts are disabled." }, { status: 403 });
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const batchId = input.batchId;
  const action = input.action;
  if (typeof action === "string" && !payoutActionAllowed(action)) {
    return NextResponse.json({ ok: false, error: "Payout action is disabled." }, { status: 403 });
  }
  const reason = input.reason;
  const uuid = (value: unknown): value is string => typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (typeof action !== "string" || (action !== "CREATE_DRAFT" && !uuid(batchId)) ||
    (reason !== undefined && (typeof reason !== "string" || reason.length > 500))) {
    return NextResponse.json({ ok: false, error: "Invalid payout review request." }, { status: 400 });
  }
  let operation: { name: string; args: Record<string, unknown> };
  const trimmedReason = typeof reason === "string" ? reason.trim() : null;
  if (action === "CREATE_DRAFT" && uuid(input.driverId) && Array.isArray(input.payableIds) &&
    input.payableIds.length >= 1 && input.payableIds.length <= 100 && input.payableIds.every(uuid) &&
    new Set(input.payableIds).size === input.payableIds.length &&
    typeof input.periodStart === "string" && Number.isFinite(Date.parse(input.periodStart)) &&
    typeof input.periodEnd === "string" && Number.isFinite(Date.parse(input.periodEnd))) {
    operation = { name: "release4_create_payout_draft", args: {
      p_driver_id: input.driverId, p_period_start: input.periodStart, p_period_end: input.periodEnd,
      p_payable_ids: input.payableIds, p_actor_id: auth.user.id,
    } };
  } else if (action === "RECONCILE" || action === "HOLD" || action === "CANCEL") {
    if (action !== "RECONCILE" && (!trimmedReason || trimmedReason.length < 3)) {
      return NextResponse.json({ ok: false, error: "A documented reason is required." }, { status: 400 });
    }
    operation = { name: "release4_review_payout", args: {
      p_batch_id: batchId, p_action: action, p_actor_id: auth.user.id, p_reason: trimmedReason,
    } };
  } else if (action === "APPROVE" && uuid(input.operationKey)) {
    operation = { name: "release4_approve_payout", args: {
      p_batch_id: batchId, p_actor_id: auth.user.id, p_operation_key: input.operationKey,
    } };
  } else if (action === "RECORD_MANUAL_PAYMENT" && uuid(input.operationKey) &&
    Number.isSafeInteger(input.amountCents) && Number(input.amountCents) > 0 &&
    (input.method === "PAYSHAP" || input.method === "EFT") &&
    typeof input.bankReference === "string" &&
    input.bankReference.trim().length >= 3 && input.bankReference.length <= 200 &&
    (input.proofReference === undefined || input.proofReference === null ||
      (typeof input.proofReference === "string" && input.proofReference.length <= 200)) &&
    typeof input.paymentAt === "string" && Number.isFinite(Date.parse(input.paymentAt))) {
    operation = { name: "release4_record_manual_payment", args: {
      p_batch_id: batchId, p_actor_id: auth.user.id, p_operation_key: input.operationKey,
      p_amount_cents: input.amountCents, p_payment_at: input.paymentAt,
      p_method: input.method, p_bank_reference: input.bankReference.trim(),
      p_proof_reference: typeof input.proofReference === "string" ? input.proofReference.trim() || null : null,
    } };
  } else if (action === "VERIFY_MANUAL_PAYMENT" && uuid(input.paymentId)) {
    operation = { name: "release4_verify_manual_payment", args: {
      p_payment_id: input.paymentId, p_reviewer: auth.user.id,
    } };
  } else if (action === "SETTLE_DEBT_ONLY") {
    operation = { name: "release4_verify_and_settle_payout", args: {
      p_batch_id: batchId, p_evidence_id: null, p_reviewer: auth.user.id,
    } };
  } else if ((action === "CANCEL_APPROVED" || action === "MARK_FAILED") &&
    trimmedReason && trimmedReason.length >= 3 &&
    (action === "CANCEL_APPROVED" || uuid(input.evidenceId))) {
    operation = { name: "release4_close_unpaid_payout", args: {
      p_batch_id: batchId, p_actor_id: auth.user.id,
      p_action: action === "CANCEL_APPROVED" ? "CANCEL" : "FAILED",
      p_reason: trimmedReason, p_evidence_id: action === "MARK_FAILED" ? input.evidenceId : null,
    } };
  } else {
    return NextResponse.json({ ok: false, error: "Invalid payout action." }, { status: 400 });
  }
  const { data, error } = await auth.supabaseAdmin.rpc(operation.name, operation.args);
  if (error) {
    console.error("[admin-online-payouts] review failed", { code: error.code });
    return NextResponse.json({ ok: false, error: "Payout review could not be completed. Refresh and check eligibility." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, status: data }, { headers: { "Cache-Control": "private, no-store" } });
}
