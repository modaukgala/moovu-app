import { NextResponse } from "next/server";
import { getAuthenticatedDriver } from "@/lib/payments/driverServer";
import { validateBankDetails } from "@/lib/finance/driverSettlement";

export async function GET(req: Request) {
  const auth = await getAuthenticatedDriver(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const { data, error } = await auth.supabaseAdmin.from("driver_payout_accounts")
    .select("account_holder,bank_name,account_number,branch_code,account_type,updated_at")
    .eq("driver_id", auth.driverId).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: "Bank details unavailable." }, { status: 503 });
  return NextResponse.json({ ok: true, bank: data });
}

export async function PUT(req: Request) {
  const auth = await getAuthenticatedDriver(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateBankDetails(body);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  const { error } = await auth.supabaseAdmin.from("driver_payout_accounts").upsert({
    driver_id: auth.driverId, ...v.value, verified_by_admin: false, updated_at: new Date().toISOString(),
  }, { onConflict: "driver_id" });
  if (error) return NextResponse.json({ ok: false, error: "Could not save bank details." }, { status: 500 });
  return NextResponse.json({ ok: true, message: "Bank details saved." });
}
