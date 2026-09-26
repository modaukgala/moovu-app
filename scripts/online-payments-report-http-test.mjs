import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
const url=process.env.PHASE3_E2E_SUPABASE_URL;
assert.equal(new URL(url).hostname,'tangtlmdpnvmoviwrgvd.supabase.co');
const db=createClient(url,process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY);
const required=({data,error})=>{assert.ifError(error);return data;};
const users=[];let browser;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p','3101'],{
  env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_ANON_KEY:process.env.PHASE3_E2E_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY},stdio:'ignore'});
try {
  for(let n=0;n<60;n++){try{await fetch('http://localhost:3101');break;}catch{await new Promise(r=>setTimeout(r,1000));}}
  const endpoint='http://localhost:3101/api/admin/online-payments?from=2026-01-01&to=2026-12-31';
  assert.equal((await fetch(endpoint)).status,401);console.log('PASS unauthenticated HTTP denied');
  let adminSession;
  for(const role of ['customer','driver','support','admin']) {
    const email=`report-${randomUUID()}@example.test`,password=randomUUID()+'Aa1!';
    const {user}=required(await db.auth.admin.createUser({email,password,email_confirm:true}));users.push(user.id);
    required(await db.from('profiles').upsert({id:user.id,role}));
    const client=createClient(url,process.env.PHASE3_E2E_SUPABASE_ANON_KEY);
    const {session}=required(await client.auth.signInWithPassword({email,password}));
    const res=await fetch(endpoint,{headers:{Authorization:`Bearer ${session.access_token}`}});
    assert.equal(res.status,role==='admin'?200:403);console.log(`PASS ${role} HTTP ${res.status}`);
    assert.ok((await client.rpc('admin_verified_yoco_payments_report',{p_from:'2026-01-01',p_to:'2026-12-31'})).error);
    if(role==='admin')adminSession=session;
  }
  const require=createRequire(import.meta.url);
  const {chromium}=require(process.env.QA_PLAYWRIGHT_PATH);
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext();
  await context.addInitScript(({session,key})=>localStorage.setItem(key,JSON.stringify(session)),{session:adminSession,key:'sb-tangtlmdpnvmoviwrgvd-auth-token'});
  // The web build intentionally retains production public config. Intercept only
  // auth and report data for layout QA; real API role checks above are not mocked.
  await context.route('**/auth/v1/**',route=>route.fulfill({json:adminSession.user}));
  await context.route('**/api/admin/online-payments?**',route=>route.fulfill({json:{ok:true,report:{total:1,total_cents:5655,trip_cents:0,commission_cents:5655,page:1,limit:20,payments:[{id:'qa-attempt',payer_type:'driver',payer:'Driver Layout Test',purpose:'Commission Payment',amount_cents:5655,verified_at:'2026-09-26T08:49:10Z',provider_payment_id:'p_layout_test',provider_checkout_id:'checkout_layout_test',payment_ledger_transaction_id:'ledger-layout-test',provider_event_id:'event-layout-test'}]}}}));
  await context.addInitScript(({session})=>{localStorage.setItem('sb-mvazbszenqahgqpznhhq-auth-token',JSON.stringify(session));},{session:adminSession});
  const page=await context.newPage();
  for(const width of [360,390,430,1280]){
    await page.setViewportSize({width,height:900});await page.goto('http://localhost:3101/admin/online-payments');
    await page.getByText('Driver Layout Test',{exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.screenshot({path:`.online-payments-${width}.png`,fullPage:true});
    await page.getByText('Driver Layout Test',{exact:true}).click();
    await page.getByRole('dialog').waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
    console.log(`PASS layout and accessible details ${width}px`);
  }
} finally {
  await browser?.close();server.kill();
  for(const id of users)required(await db.auth.admin.deleteUser(id));
}
