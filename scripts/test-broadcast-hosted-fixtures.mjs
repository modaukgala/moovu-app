import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {fixtureFare} from './lib/pure-fare-fixture.mjs';

const origin=process.argv.find(x=>x.startsWith('--url='))?.slice(6)||'https://moovu-critical-reliability-release-r9kjvvx4j.vercel.app';
assert.match(origin,/^https:\/\/moovu-critical-reliability-release-[a-z0-9]+\.vercel\.app$/);
const ref='dzcgwzvxgelhzukpjhpa';
const env=parseEnv(readFileSync('.env.staging-broadcast.local','utf8'));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,`https://${ref}.supabase.co`);
const credential=parseEnv(readFileSync('D:/MOOVU Secure Backups/Stage2 Auth Acceptance/broadcast-worker-secret.env','utf8')).DISPATCH_JOB_SECRET;
const accounts=JSON.parse(readFileSync('D:/MOOVU Secure Backups/Stage2 Auth Acceptance/provisioned-accounts.json','utf8'));
const result=spawnSync('pwsh',['-NoProfile','-Command',"vercel api '/v9/projects/prj_gRjAiG5OmahKUZ2cyAT5nlbigzMh?teamId=team_n9nCZ25XkmOvsGXAyLDBw63B' --raw"],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
assert.equal(result.status,0);
const bypass=Object.keys(JSON.parse(result.stdout).protectionBypass??{}).find(k=>k.length>20);assert.ok(bypass);
const secrets=[credential,bypass,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,env.MAPS_ROUTE_QUOTE_SECRET];
let checks=0;
const check=(name,ok)=>{assert.ok(ok,name);checks++;console.log(JSON.stringify({name,status:'PASS'}));};
async function login(email,password){
 const c=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const r=await c.auth.signInWithPassword({email,password});assert.ok(!r.error,'Hosted synthetic login');
 secrets.push(password,r.data.session.access_token,r.data.session.refresh_token);return r.data.session.access_token;
}
async function api(path,body,token){
 const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'x-vercel-protection-bypass':bypass,...(token?{authorization:`Bearer ${token}`}:{}) ,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 return {status:r.status,body:await r.json().catch(()=>null)};
}
try {
 if(process.argv.includes('--read-only')) {
  const adminToken=await login(accounts.admin.email,accounts.admin.password);
  check('Rollback Admin dispatch read remains available',(await api('/api/admin/dispatch/board',undefined,adminToken)).status===200);
  check('Rollback Admin payout read remains available',(await api('/api/admin/online-payouts',undefined,adminToken)).status===200);
  for(const role of ['driver_a','driver_b']) {
   const token=await login(accounts[role].email,accounts[role].password);
   check('Rollback Driver offer read remains available',(await api('/api/driver/offers/current',undefined,token)).status===200);
   check('Rollback Driver payout read remains available',(await api('/api/driver/online-payouts',undefined,token)).status===200);
  }
  console.log(JSON.stringify({status:'PASS',checks,scope:'Authenticated read-only rollback against migrated staging schema',productionChanges:0}));
 } else {
 check('Hosted worker rejects anonymous access',(await api('/api/jobs/broadcast',{})).status===401);
 check('Hosted worker rejects invalid credential',(await api('/api/jobs/broadcast',{},'invalid')).status===401);
 check('Hosted worker accepts its configured credential',(await api('/api/jobs/broadcast',{},credential)).status===200);
 const driverTokens=await Promise.all(['driver_a','driver_b'].map(r=>login(accounts[r].email,accounts[r].password)));
 const adminToken=await login(accounts.admin.email,accounts.admin.password);
 check('Hosted Admin dispatch board works',(await api('/api/admin/dispatch/board',undefined,adminToken)).status===200);
 for(const token of driverTokens)check('Hosted Driver presence works',(await api('/api/driver/presence',{},token)).body?.ok===true);
 const suffix=randomBytes(5).toString('hex'),password=randomBytes(24).toString('base64url')+'Aa1',email=`broadcast-${suffix}@example.invalid`;
 secrets.push(password);
 const registered=await api('/api/customer/register',{first_name:'Synthetic',last_name:'Broadcast',email,phone:'0646'+String(Date.now()).slice(-6),password,
  acceptedTerms:true,acceptedPrivacy:true,termsVersion:'2026-06-23',privacyVersion:'2026-06-23'});
 check(`Hosted Customer registration HTTP ${registered.status}`,registered.body?.ok===true);
 const customerToken=await login(email,password);
 const payload=Buffer.from(JSON.stringify({routeSignature:'-25.70000,28.70000|-25.71000,28.71000||driving',distanceKm:2,durationMin:5,originalDistanceKm:2,originalDurationMin:5,expiresAt:Date.now()+300000})).toString('base64url');
 const routeQuote=`${payload}.${createHmac('sha256',env.MAPS_ROUTE_QUOTE_SECRET||credential).update(payload).digest('base64url')}`;
 const uplift=env.MOOVU_UNIVERSAL_FARE_23_ENABLED==='true';
 const priced=fixtureFare({phase5Active:true,uplift});
 const booking=await api('/api/customer/book-trip',{pickupAddress:`Synthetic broadcast ${suffix}`,dropoffAddress:'Synthetic destination',pickupLat:-25.7,pickupLng:28.7,
  dropoffLat:-25.71,dropoffLng:28.71,distanceKm:2,durationMin:5,originalDistanceKm:2,originalDurationMin:5,rideType:'now',rideOption:'go',paymentMethod:'cash',routeQuote,
  expectedPricingVersion:priced.version,expectedRideFareCents:priced.rideFareCents,
  phase5ExpectedTotalCents:priced.rideFareCents+300,bookingKey:randomUUID()},customerToken);
 check(`Hosted booking HTTP ${booking.status}: ${booking.body?.code??booking.body?.error??'ok'}`,booking.body?.ok===true);
 const tripId=booking.body.tripId;assert.match(tripId,/^[a-f0-9-]{36}$/i);
 const offers=await Promise.all(driverTokens.map(t=>api('/api/driver/offers/current',undefined,t)));
 check('Both hosted Drivers retrieve the same persisted trip',offers.every(r=>r.body?.offer?.id===tripId));
 const race=await Promise.all(driverTokens.map(t=>api('/api/driver/offers/respond',{tripId,action:'accept'},t)));
 check('Hosted concurrent acceptance has one winner',race.filter(r=>r.body?.ok===true).length===1);
 console.log(JSON.stringify({status:'PASS',checks,tripId,stagingProject:ref,productionChanges:0,deviceDelivery:'UNVERIFIED'}));
 }
} catch(error){let message=String(error.message);for(const value of secrets.filter(Boolean))message=message.replaceAll(value,'[redacted]');console.error(JSON.stringify({status:'FAIL',checks,message:message.slice(0,1500),productionChanges:0}));process.exitCode=1;}
