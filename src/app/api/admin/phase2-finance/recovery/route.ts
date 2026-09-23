import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) {
    return NextResponse.json({ ok: false, error: "Financial Admin required." }, { status: 403 });
  }
  const url = new URL(req.url);
  const status = url.searchParams.get("status")?.trim();
  let query = auth.supabaseAdmin
    .from("phase2_shadow_recovery_jobs")
    .select("id,operation_key,trip_id,status,attempts,last_error_code,last_error_message,last_attempt_at,next_attempt_at,succeeded_at,financial_transaction_id,reconciliation_id,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: "Phase 2 recovery status is unavailable." }, { status: 503 });
  return NextResponse.json({ ok: true, jobs: data ?? [] });
}
