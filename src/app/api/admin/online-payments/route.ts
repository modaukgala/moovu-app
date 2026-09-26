import { NextResponse } from 'next/server';
import { requireAdminUser, isFinancialAdminRole } from '@/lib/auth/admin';
import { onlineReportFilters } from '@/lib/payments/onlineReport';

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: 'Financial Admin access required.' }, { status: 403 });
  let filters;
  try { filters = onlineReportFilters(new URL(req.url).searchParams); }
  catch { return NextResponse.json({ ok: false, error: 'Choose a valid date range of up to one year.' }, { status: 400 }); }
  const { data, error } = await auth.supabaseAdmin.rpc('admin_verified_yoco_payments_report', filters);
  if (error) {
    console.error('[admin-online-payments] report failed', { code: error.code });
    return NextResponse.json({ ok: false, error: "We couldn't load online payments." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, report: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
