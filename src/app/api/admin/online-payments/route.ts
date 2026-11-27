import { NextResponse } from 'next/server';
import { requireAdminUser, isFinancialAdminRole } from '@/lib/auth/admin';
import { onlineReportFilters } from '@/lib/payments/onlineReport';
import { fulfilmentKinds, readYocoFulfilment } from '@/lib/admin/yocoFulfilment';

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: 'Financial Admin access required.' }, { status: 403 });
  const params = new URL(req.url).searchParams;
  if (params.get("view") === "fulfilment") {
    const filter = params.get("fulfilment") ?? "actionable";
    const state = params.get("state") ?? "all";
    const page = Number(params.get("page") ?? 1);
    const pageSize = 25;
    if (!["all", "actionable", ...fulfilmentKinds].includes(filter) ||
        !/^(all|[A-Z_]{1,40})$/.test(state) || !Number.isSafeInteger(page) || page < 1 || page > 100000) {
      return NextResponse.json({ ok: false, error: "Invalid fulfilment filters." }, { status: 400 });
    }
    try {
      const report = await readYocoFulfilment(auth.supabaseAdmin);
      const rows = report.rows.filter((row) => (state === "all" || row.state === state) &&
        (filter === "all" || (filter === "actionable" ? row.actionable : row.primary === filter ||
          row.reasons.some((reason) => reason === filter))));
      return NextResponse.json({ ok: true, complete: report.complete, total: report.complete ? rows.length : null,
        retrieved: rows.length, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize) },
      { headers: { "Cache-Control": "private, no-store" } });
    } catch {
      return NextResponse.json({ ok: false, error: "Yoco fulfilment evidence is unavailable." }, { status: 503 });
    }
  }
  let filters;
  try { filters = onlineReportFilters(new URL(req.url).searchParams); }
  catch { return NextResponse.json({ ok: false, error: 'Choose a valid date range of up to one year.' }, { status: 400 }); }
  const { data, error } = await auth.supabaseAdmin.rpc('admin_verified_yoco_payments_report', filters);
  if (error) {
    console.error('[admin-online-payments] report failed', { code: error.code });
    return NextResponse.json({ ok: false, error: "We couldn't load online payments." }, { status: 500 });
  }
  // Add what happened to each paid trip, and the customer's phone, so refunds can be arranged.
  const report = data as { payments?: Array<Record<string, unknown>> } | null;
  const rows = report?.payments ?? [];
  const tripIds = rows.map(r => r.trip_id).filter((v): v is string => typeof v === 'string');
  const attemptIds = rows.map(r => r.id).filter((v): v is string => typeof v === 'string');
  if (tripIds.length) {
    const [trips, attempts, asks] = await Promise.all([
      auth.supabaseAdmin.from('trips').select('id,status,rider_phone,rider_name').in('id', tripIds),
      auth.supabaseAdmin.from('online_payment_attempts').select('id,state').in('id', attemptIds),
      auth.supabaseAdmin.from('customer_refund_requests').select('trip_id,status').in('trip_id', tripIds),
    ]);
    const tripById = new Map((trips.data ?? []).map(t => [t.id, t]));
    const stateById = new Map((attempts.data ?? []).map(a => [a.id, a.state]));
    const askByTrip = new Map((asks.data ?? []).map(a => [a.trip_id, a.status]));
    for (const row of rows) {
      const trip = typeof row.trip_id === 'string' ? tripById.get(row.trip_id) : undefined;
      if (!trip) continue;
      const refunded = stateById.get(String(row.id)) === 'REFUNDED' || askByTrip.get(trip.id) === 'REFUNDED';
      row.customer_phone = trip.rider_phone ?? null;
      row.trip_status = trip.status;
      row.outcome = trip.status === 'completed' ? 'COMPLETED'
        : refunded ? 'REFUNDED'
        : askByTrip.get(trip.id) === 'REQUESTED' ? 'REFUND_REQUESTED'
        : trip.status === 'cancelled' ? 'CANCELLED_NOT_REFUNDED' : 'IN_PROGRESS';
    }
  }
  return NextResponse.json({ ok: true, report: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
