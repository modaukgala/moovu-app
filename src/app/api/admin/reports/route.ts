import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { GET as readOverview } from "../earnings/route";
import { earningsPeriod } from "@/lib/admin/earningsMetrics";
import { completedTrips } from "@/lib/admin/earningsRead";
import { collectBoundedPages } from "@/lib/admin/boundedRetrieval";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Financial Admin required." }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const page = Number(params.get("page") ?? 1);
  const cancellationPage = Number(params.get("cancellationPage") ?? 1);
  const historicalPage = Number(params.get("historicalPage") ?? 1);
  const undated = params.get("historicalDates") === "unavailable";
  const pageSize = 25;
  let period: ReturnType<typeof earningsPeriod>;
  try {
    period = earningsPeriod(params);
    if ([page, cancellationPage, historicalPage].some((n) => !Number.isSafeInteger(n) || n < 1 || n > 100000)) throw new Error();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid date range or page." }, { status: 400 });
  }
  const db = auth.supabaseAdmin;
  const assessments = () => db.from("phase4_fee_assessments")
    .select("id,trip_id,assessed_at,fee_type,fee_cents,driver_cents,moovu_cents", { count: "exact" })
    .gte("assessed_at", period.start).lt("assessed_at", period.end)
    .order("assessed_at", { ascending: false }).order("id", { ascending: false });
  async function historicalHistory() {
    const fields = "id,trip_id,created_at,fee_type,fee_amount,driver_amount,moovu_amount";
    const read = (excludeLinked: boolean) => {
      let query = db.from("trip_cancellation_fees").select(fields, { count: "exact" });
      if (excludeLinked) query = query.is("phase4_assessment_id", null);
      return (undated ? query.is("created_at", null) : query.gte("created_at", period.start).lt("created_at", period.end))
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range((historicalPage - 1) * pageSize, historicalPage * pageSize - 1);
    };
    let result = await read(true);
    let relationship = "no_stored_phase4_link";
    if (result.error?.code === "42703" && result.error.message.includes("phase4_assessment_id")) {
      result = await read(false);
      relationship = "unverified";
    }
    if (result.error || !result.data || result.count == null) return null;
    const tripIds = [...new Set(result.data.flatMap((row) => row.trip_id ? [row.trip_id] : []))];
    const tripStatus = new Map<string, string>();
    if (tripIds.length) {
      try {
        const trips = await db.from("trips").select("id,status").in("id", tripIds);
        if (!trips.error) for (const row of trips.data ?? []) tripStatus.set(row.id, row.status);
      } catch {
        // Optional trip context must not hide recorded fee history.
      }
    }
    return { rows: result.data.map((row) => ({ ...row, trip_status: tripStatus.get(row.trip_id) ?? null })),
      count: result.count, relationship };
  }
  const [overview, trips, cancellations, cancellationTotals, historical] = await Promise.all([
    readOverview(req).then((response) => response.ok ? response.json() : null).catch(() => null),
    completedTrips(db, period).range((page - 1) * pageSize, page * pageSize - 1).then((result) =>
      result.error || !result.data || result.count == null ? null : { rows: result.data, count: result.count }),
    assessments().range((cancellationPage - 1) * pageSize, cancellationPage * pageSize - 1).then((result) =>
      result.error || !result.data || result.count == null ? null : { rows: result.data, count: result.count }),
    collectBoundedPages<{ fee_cents: number; driver_cents: number; moovu_cents: number }>({
      pageSize: 500, maxRows: 10000,
      load: async (from, to) => {
        const result = await assessments().range(from, to);
        if (result.error || !result.data) throw new Error("Cancellation assessments unavailable.");
        return result.data as { fee_cents: number; driver_cents: number; moovu_cents: number }[];
      },
    }).catch(() => null),
    historicalHistory().catch(() => null),
  ]);
  const ids = cancellations?.rows.map((row) => row.id) ?? [];
  const [liabilities, compensation] = ids.length ? await Promise.all([
    db.from("phase4_customer_liabilities").select("assessment_id,original_cents,open_cents,status").in("assessment_id", ids),
    db.from("phase4_driver_compensations").select("assessment_id,earned_cents,settled_cents,status").in("assessment_id", ids),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  const liabilityById = new Map((liabilities.data ?? []).map((row) => [row.assessment_id, row]));
  const compensationById = new Map((compensation.data ?? []).map((row) => [row.assessment_id, row]));
  const complete = cancellationTotals?.complete ?? null;
  const sum = (key: "fee_cents" | "driver_cents" | "moovu_cents") =>
    cancellationTotals?.complete && cancellationTotals.rows.every((row) => Number.isSafeInteger(row[key]))
      ? cancellationTotals.rows.reduce((total, row) => total + row[key], 0) / 100 : null;
  return NextResponse.json({ ok: true, period, page, cancellationPage, historicalPage, pageSize, overview, trips, historical,
    cancellations: cancellations && { count: cancellations.count, rows: cancellations.rows.map((row) => ({
      ...row, liability: liabilityById.get(row.id) ?? null, compensation: compensationById.get(row.id) ?? null,
      liabilityUnavailable: !!liabilities.error, compensationUnavailable: !!compensation.error,
    })) },
    cancellationSummary: { complete, assessed: sum("fee_cents"), driverShare: sum("driver_cents"), platformShare: sum("moovu_cents"),
      collected: null, paid: null },
  });
}
