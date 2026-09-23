import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { callPhase4Rpc } from "@/lib/server/phase4Rpc";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Financial Admin required." }, { status: 403 });
  const tripId = new URL(req.url).searchParams.get("tripId")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) return NextResponse.json({ ok: false, error: "Valid trip ID required." }, { status: 400 });
  const { data: assessment, error } = await auth.supabaseAdmin.from("phase4_fee_assessments")
    .select("*").eq("trip_id", tripId).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: "Finance state unavailable." }, { status: 503 });
  if (!assessment) return NextResponse.json({ ok: true, assessment: null });
  const [liability, compensation, grace, transaction, actions, events] = await Promise.all([
    auth.supabaseAdmin.from("phase4_customer_liabilities").select("*").eq("assessment_id", assessment.id).maybeSingle(),
    auth.supabaseAdmin.from("phase4_driver_compensations").select("*").eq("assessment_id", assessment.id).maybeSingle(),
    auth.supabaseAdmin.from("phase4_customer_grace_cycles").select("*").eq("customer_id", assessment.customer_id).is("resolved_at", null).maybeSingle(),
    auth.supabaseAdmin.from("financial_transactions").select("id,transaction_type,transaction_state,posted_at")
      .eq("source_type", "PHASE4_ASSESSMENT").eq("source_id", assessment.id)
      .in("transaction_type", ["CANCELLATION_FEE", "NO_SHOW_FEE"]).maybeSingle(),
    auth.supabaseAdmin.from("phase4_financial_actions").select("*").eq("assessment_id", assessment.id).order("created_at"),
    auth.supabaseAdmin.from("moovu_business_events").select("id,event_key,event_type,created_at")
      .eq("aggregate_id", tripId).order("created_at"),
  ]);
  if ([liability, compensation, grace, transaction, actions, events].some((result) => result.error)) {
    return NextResponse.json({ ok: false, error: "Finance state is incomplete." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, assessment, liability: liability.data,
    compensation: compensation.data, grace: grace.data, transaction: transaction.data,
    actions: actions.data, events: events.data });
}

export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Financial Admin required." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const assessmentId = String(body?.assessmentId ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  const action = String(body?.action ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(assessmentId) || reason.length < 3 || reason.length > 500) {
    return NextResponse.json({ ok: false, error: "Assessment and a reason of 3–500 characters are required." }, { status: 400 });
  }
  const rpc = action === "REVERSAL" ? "phase4b_reverse_unpaid_assessment" : "phase4_admin_liability_action";
  if (!["DISPUTE_OPENED", "DISPUTE_RESOLVED", "WAIVER", "REVERSAL"].includes(action)) {
    return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
  }
  const result = await callPhase4Rpc<Record<string, unknown>>(auth.supabaseAdmin, rpc, {
    p_assessment_id: assessmentId, p_actor_id: auth.user.id,
    ...(action === "REVERSAL" ? {} : { p_action: action }), p_reason: reason,
  }, (value) => typeof value.assessment_id === "string" && typeof value.replayed === "boolean");
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
  return NextResponse.json({ ok: true, result: result.result });
}
