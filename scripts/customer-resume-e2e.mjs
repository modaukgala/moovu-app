import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createClient} from '@supabase/supabase-js';
const url=process.env.PHASE3_E2E_SUPABASE_URL;
assert.equal(new URL(url).hostname,'tangtlmdpnvmoviwrgvd.supabase.co');
const db=createClient(url,process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY);
const required=({data,error})=>{assert.ifError(error);return data;};
const run=randomUUID();let browser;let passed=0;
const check=(name,condition)=>{assert.ok(condition,name);console.log('PASS '+name);passed++;};
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p','3102'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_ANON_KEY:process.env.PHASE3_E2E_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY},stdio:'ignore'});
try {
  for(let n=0;n<60;n++){try{await fetch('http://localhost:3102');break;}catch{await new Promise(r=>setTimeout(r,1000));}}
  const sessions=[],customers=[];
  for(let i=0;i<2;i++){
    const email=`resume-${run}-${i}@example.test`,password=randomUUID()+'Aa1!';
    const {user}=required(await db.auth.admin.createUser({email,password,email_confirm:true}));
    required(await db.from('profiles').upsert({id:user.id,role:'customer'}));
    const phone='+278'+String(Date.now()+i).slice(-8);
    const customer=required(await db.from('customers').insert({auth_user_id:user.id,first_name:'ResumeTest',last_name:run,phone,normalized_phone:phone,status:'active'}).select('id').single());customers.push(customer.id);
    sessions.push(required(await createClient(url,process.env.PHASE3_E2E_SUPABASE_ANON_KEY).auth.signInWithPassword({email,password})).session);
  }
  const endpoint='http://localhost:3102/api/customer/active-trip';
  const resolve=async(index=0)=>{const res=await fetch(endpoint,{headers:{Authorization:`Bearer ${sessions[index].access_token}`}});assert.equal(res.status,200);return res.json();};
  check('Anonymous cannot resolve trips',(await fetch(endpoint)).status===401);
  check('No trip returns normal entry',(await resolve()).destination===null);
  const id=randomUUID();required(await db.from('trips').insert({id,customer_id:customers[0],pickup_address:'Disposable resume '+run,dropoff_address:'Test',pickup_lat:-25.48,pickup_lng:28.68,dropoff_lat:-25.49,dropoff_lng:28.70,status:'requested',payment_method:'cash',ride_option:'go',fare_amount:50}));
  for(const status of ['requested','offered','assigned','arrived','ongoing']){
    required(await db.from('trips').update({status}).eq('id',id));check(`${status} restores existing trip`,(await resolve()).destination===`/ride/${id}`);
  }
  check('Another customer cannot see trip',(await resolve(1)).destination===null);
  for(const status of ['completed','cancelled']){
    required(await db.from('trips').update({status}).eq('id',id));check(`${status} does not capture entry`,(await resolve()).destination===null);
  }
  required(await db.from('trips').update({status:'requested',ride_type:'scheduled',scheduled_for:'2041-01-01T12:00:00Z'}).eq('id',id));
  check('Future scheduled trip does not capture entry',(await resolve()).destination===null);
  required(await db.from('trips').update({status:'requested',ride_type:'now',scheduled_for:null,payment_method:'online'}).eq('id',id));
  check('Unpaid online preserves confirmation flow',(await resolve()).destination===`/payment/success?tripId=${id}`);
  required(await db.from('online_payment_attempts').insert({customer_id:customers[0],trip_id:id,provider:'FAKE_TEST',state:'SUCCEEDED',amount_cents:5000,fare_version:'a'.repeat(64),locked_fare_snapshot:{},payload_hash:'b'.repeat(64),idempotency_key:'resume:'+run,verified_at:new Date().toISOString()}));
  check('Verified online restores status',(await resolve()).destination===`/ride/${id}`);
  const anomaly=randomUUID();
  required(await db.from('trips').insert({id:anomaly,customer_id:customers[0],pickup_address:'Disposable anomaly '+run,dropoff_address:'Test',status:'requested',payment_method:'cash',created_at:new Date(Date.now()+1000).toISOString()}));
  check('Multiple candidates resolve deterministically to newest owned trip',(await resolve()).destination===`/ride/${anomaly}`&&(await resolve()).destination===`/ride/${anomaly}`);
  required(await db.from('trips').update({status:'cancelled'}).eq('id',anomaly));
  const {chromium}=createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT_PATH);browser=await chromium.launch({headless:true,channel:'msedge'});
  for(let n=0;n<2;n++){
    const context=await browser.newContext();await context.addInitScript(({session})=>localStorage.setItem('sb-tangtlmdpnvmoviwrgvd-auth-token',JSON.stringify(session)),{session:sessions[0]});
    const page=await context.newPage();await page.goto('http://localhost:3102/');await page.waitForURL(`**/ride/${id}`);check(`Fresh browser/device ${n+1} restores server trip`,true);await context.close();
  }
  const context=await browser.newContext();await context.addInitScript(({session})=>localStorage.setItem('sb-tangtlmdpnvmoviwrgvd-auth-token',JSON.stringify(session)),{session:sessions[0]});
  await context.route('**/api/customer/active-trip',route=>route.abort());
  const page=await context.newPage();await page.goto('http://localhost:3102/');await page.getByText('We could not check your current ride.',{exact:true}).waitFor();check('Network failure blocks booking entry safely',await page.getByRole('button',{name:'Try again',exact:true}).count()===1);
  await page.goto(`http://localhost:3102/payment/success?tripId=${id}`);await page.waitForTimeout(1000);check('Payment return is not hijacked',page.url().includes('/payment/success'));
  await context.close();console.log(JSON.stringify({passed,run}));
} finally {await browser?.close();server.kill();}
// Keep disposable fixtures as evidence; no production records or payment provider calls.
