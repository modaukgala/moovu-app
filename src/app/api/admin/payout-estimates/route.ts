import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { readPayoutEstimates } from "@/lib/finance/payoutEstimateRead";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Financial Admin required." }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const id = params.get("driverId");
  const page = Number(params.get("page") ?? 1);
  if (!id || !Number.isSafeInteger(page) || page < 1 || page > 100000) return NextResponse.json({ ok: false, error: "Invalid driver or page." }, { status: 400 });
  try { return NextResponse.json({ ok: true, ...await readPayoutEstimates(auth.supabaseAdmin, id, page) }); }
  catch { return NextResponse.json({ ok: false, error: "Payout estimates unavailable." }, { status: 503 }); }
}
