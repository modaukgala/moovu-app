import { NextResponse } from "next/server";
import { getAuthenticatedDriver } from "@/lib/payments/driverServer";
import { readPayoutEstimates } from "@/lib/finance/payoutEstimateRead";

export async function GET(req: Request) {
  const auth = await getAuthenticatedDriver(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const params = new URL(req.url).searchParams;
  if (params.has("driverId") && params.get("driverId") !== auth.driverId) {
    return NextResponse.json({ ok: false, error: "Driver access denied." }, { status: 403 });
  }
  const page = Number(params.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return NextResponse.json({ ok: false, error: "Invalid page." }, { status: 400 });
  try { return NextResponse.json({ ok: true, ...await readPayoutEstimates(auth.supabaseAdmin, auth.driverId, page) }); }
  catch { return NextResponse.json({ ok: false, error: "Payout estimates unavailable." }, { status: 503 }); }
}
