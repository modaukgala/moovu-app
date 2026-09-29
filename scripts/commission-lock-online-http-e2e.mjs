import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const url = process.env.PHASE3_E2E_SUPABASE_URL;
assert.equal(new URL(url).hostname, 'tangtlmdpnvmoviwrgvd.supabase.co');
const key = process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, key, { auth: { persistSession: false } });
const ok = r => { assert.ifError(r.error); return r.data; };
const port = 3107;
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.PHASE3_E2E_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: key, MOOVU_PHASE2_FINANCE_MODE: 'AUTHORITATIVE',
    NODE_ENV: 'development', MOOVU_PHASE6_NEW_WORK_ELIGIBILITY: 'disabled',
    NEXT_PUBLIC_MOOVU_PHASE6_NEW_WORK_ELIGIBILITY: 'disabled' }, stdio: 'ignore',
});
let userId;
try {
  for (let attempt = 0; ; attempt++) {
    assert.equal(child.exitCode, null, 'Disposable server exited before becoming ready');
    try { await fetch(`http://localhost:${port}/driver/login`); break; }
    catch { assert.ok(attempt < 60, 'Disposable API server did not start'); await new Promise(r => setTimeout(r, 1000)); }
  }
  const email = `debt-http-${randomUUID()}@example.invalid`, password = randomUUID() + randomUUID();
  const user = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user;
  userId = user.id;
  const driver = ok(await admin.from('drivers').select('id').eq('first_name', 'DebtPolicyTest')
    .order('created_at', { ascending: false }).limit(1))[0];
  assert.ok(driver);
  const position = ok(await admin.rpc('phase2_finance_eligibility', { p_driver_id: driver.id }));
  assert.equal(Number(position.net_owed_cents), 50000);
  ok(await admin.from('driver_accounts').insert({ user_id: userId, driver_id: driver.id }));
  ok(await admin.from('drivers').update({ busy: false }).eq('id', driver.id));
  const auth = createClient(url, process.env.PHASE3_E2E_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const session = ok(await auth.auth.signInWithPassword({ email, password })).session;
  const change = async online => {
    const response = await fetch(`http://localhost:${port}/api/driver/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ online }),
    });
    return { status: response.status, body: await response.json() };
  };
  const enabled = await change(true);
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  assert.equal(enabled.body.online, true);
  ok(await admin.from('drivers').update({ status: 'inactive' }).eq('id', driver.id));
  assert.equal((await change(true)).status, 403, 'Account approval restriction must remain');
  ok(await admin.from('drivers').update({ status: 'approved' }).eq('id', driver.id));
  assert.equal((await change(false)).status, 200);
  assert.equal(Number(ok(await admin.rpc('phase2_finance_eligibility', { p_driver_id: driver.id })).net_owed_cents), 50000);
  console.log('PASS: authenticated online/offline HTTP with R500 debt; inactive account rejected; debt unchanged');
} finally {
  if (userId) {
    await admin.from('driver_accounts').delete().eq('user_id', userId);
    await admin.auth.admin.deleteUser(userId);
  }
  if (child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }
}
