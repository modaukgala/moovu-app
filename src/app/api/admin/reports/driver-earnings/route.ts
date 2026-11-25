import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { earningsPeriod, summariseTrips } from "@/lib/admin/earningsMetrics";
import { completedTrips, scanTrips, verifiedOnlineReceipts } from "@/lib/admin/earningsRead";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
  const db = auth.supabaseAdmin;
  const params = new URL(req.url).searchParams;
  const page = Number(params.get("page") ?? 1);
  let period;
  try {
    period = earningsPeriod(params);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error();
  } catch {
    return NextResponse.json({ ok: false, error: "Choose a valid date range and page." }, { status: 400 });
  }
  const pageSize = 30;
  const [result, all, verified] = await Promise.all([
    completedTrips(db, period).range((page - 1) * pageSize, page * pageSize - 1),
    scanTrips(db, period).catch(() => null),
    verifiedOnlineReceipts(db, period).catch(() => null),
  ]);
  if (result.error || result.count == null || !result.data) return NextResponse.json({ ok: false, error: "Trip history unavailable." }, { status: 503 });
  const ids = [...new Set(result.data.flatMap((row) => row.driver_id ? [row.driver_id] : []))];
  const drivers = ids.length ? await db.from("drivers").select("id,first_name,last_name").in("id", ids) : { data: [] };
  const names = new Map((drivers.data ?? []).map((row) => [row.id, [row.first_name, row.last_name].filter(Boolean).join(" ")]));
  return NextResponse.json({
    ok: true, period, page, pageSize, total: result.count,
    rows: result.data.map((row) => ({ ...row, driver_name: names.get(row.driver_id) || null })),
    totals: all?.complete ? summariseTrips(all.rows) : null,
    totalsState: all?.complete ? "complete" : all ? "partial" : "unavailable",
    verifiedOnlineTripReceipts: verified?.customerTrips ?? null,
    driverPayoutObligations: null,
  });
}
