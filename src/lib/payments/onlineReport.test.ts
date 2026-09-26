import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
// @ts-expect-error Node's native test runner requires the TypeScript extension.
import { onlineReportFilters } from './onlineReport.ts';

test('report validates exclusive date range and bounded server pagination',()=>{
  const filters=onlineReportFilters(new URLSearchParams({from:'2026-09-01T00:00:00+02:00',to:'2026-10-01T00:00:00+02:00',page:'2',payer:'driver'}));
  assert.equal(filters.p_from,'2026-08-31T22:00:00.000Z');assert.equal(filters.p_limit,20);assert.equal(filters.p_page,2);
  const invalid: Record<string,string>[]=[{page:'0'},{page:'1.5'},{payer:'support'},{from:'bad'},{to:'2028-01-01'}];
  for(const patch of invalid) {
    assert.throws(()=>onlineReportFilters(new URLSearchParams({from:'2026-09-01',to:'2026-10-01',...patch})));
  }
});
test('SQL reporting is read-only, service-only, verified and canonical',()=>{
  const sql=readFileSync('supabase/migrations/20260926124203_admin_verified_yoco_payments_report.sql','utf8');
  assert.doesNotMatch(sql,/\b(insert|update|delete|truncate)\b/i);
  assert.match(sql,/stable security invoker/);assert.match(sql,/from public,anon,authenticated/);
  assert.match(sql,/state='SUCCEEDED'/);assert.match(sql,/trust_state='VERIFIED'/);
  assert.match(sql,/processing_state='PROCESSED'/);assert.match(sql,/distinct on \(provider_payment_id\)/);
  assert.match(sql,/from filtered/);assert.match(sql,/obligation_type='COMMISSION_DEBT'/);
});
test('API authorizes financial admin before report query and exposes no mutation',()=>{
  const api=readFileSync('src/app/api/admin/online-payments/route.ts','utf8');
  assert.ok(api.indexOf('requireAdminUser(req)')<api.indexOf('.rpc('));
  assert.ok(api.indexOf('isFinancialAdminRole(auth.profile.role)')<api.indexOf('.rpc('));
  assert.doesNotMatch(api,/export async function (POST|PUT|DELETE|PATCH)/);
  assert.match(api,/private, no-store/);
});
