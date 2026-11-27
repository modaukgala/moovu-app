import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { adminDriverName } from "@/lib/admin/identity";
import { loadAdminReviewMetric } from "@/lib/admin/applicationAuthority";

const NO_STORE = { "Cache-Control": "private, no-store" };

async function count(query: PromiseLike<{ count: number | null; error: unknown }>) {
  const result = await query;
  return result.error ? null : result.count ?? 0;
}

/** Admin home: latest 5 ride requests and the short "needs you" list. Read-only. */
export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const db = auth.supabaseAdmin;

  const { data: trips, error } = await db.from("trips")
    .select("id,rider_name,rider_phone,pickup_address,dropoff_address,status,driver_id,payment_method,fare_amount,created_at,scheduled_for,offer_status,offer_expires_at")
    .order("created_at", { ascending: false }).limit(5);
  if (error) return NextResponse.json({ ok: false, error: "Recent trips are unavailable." }, { status: 503 });

  const driverIds = [...new Set((trips ?? []).map(t => t.driver_id).filter(Boolean))] as string[];
  const { data: drivers } = driverIds.length
    ? await db.from("drivers").select("id,first_name,last_name,phone").in("id", driverIds)
    : { data: [] as { id: string; first_name: string | null; last_name: string | null; phone: string | null }[] };
  const byId = new Map((drivers ?? []).map(d => [d.id, d]));

  const [onlineDrivers, liveTrips, payouts, refunds, applications] = await Promise.all([
    count(db.from("drivers").select("id", { count: "exact", head: true }).eq("online", true)),
    count(db.from("trips").select("id", { count: "exact", head: true }).in("status", ["requested", "offered", "assigned", "arrived", "ongoing"])),
    count(db.from("driver_payout_requests").select("id", { count: "exact", head: true }).eq("status", "REQUESTED")),
    count(db.from("customer_refund_requests").select("id", { count: "exact", head: true }).eq("status", "REQUESTED")),
    loadAdminReviewMetric().then(m => (Number.isSafeInteger(m?.count) ? m.count : null)).catch(() => null),
  ]);

  return NextResponse.json({
    ok: true,
    recent: (trips ?? []).map(t => {
      const d = t.driver_id ? byId.get(t.driver_id) : null;
      return { ...t, driver_name: d ? adminDriverName(d) : null, driver_phone: d?.phone ?? null };
    }),
    live: { onlineDrivers, liveTrips },
    needsYou: { payouts, refunds, applications },
  }, { headers: NO_STORE });
}
