import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Handler = (request: Request) => Promise<Response>;
function load<T>(path: string, dependencies: Record<string,unknown> = {}, env: Record<string,string> = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText,{exports, URL, process:{env}, console, require:(name:string)=>dependencies[name]});
  return exports as T;
}
const route = (path:string, dependencies:Record<string,unknown>, env?:Record<string,string>) =>
  load<{GET:Handler;POST:Handler}>(`../../app/api/admin/${path}/route.ts`,{"next/server":{NextResponse:Response},...dependencies},env);
const role = (value:string|null, db:unknown = {})=>({
  requireAdminUser:async()=>value ? {ok:true, profile:{role:value}, user:{id:"authenticated"}, supabaseAdmin:db} : {ok:false,status:401,error:"Unauthenticated"},
  isFinancialAdminRole:(candidate:string)=>candidate==="owner" || candidate==="admin",
});
const request = (query = "") => new Request("https://local.invalid/"+query);
const management = load<typeof import("./businessManagement")>("./businessManagement.ts");
const queues = load<typeof import("./operationalCounts")>("./operationalCounts.ts");
const fare = load<typeof import("../domain/fare")>("../domain/fare.ts");

function managementRoute(user:string|null, db:unknown, env:Record<string,string> = {}) {
  return route("business-management",{
    "@/lib/auth/admin":role(user,db), "@/lib/admin/businessManagement":management, "@/lib/domain/fare":fare,
    "@/lib/trips/adminTripPaymentMethod":load("../trips/adminTripPaymentMethod.ts"),
    "@/lib/payments/customerPaymentMethod":load("../payments/customerPaymentMethod.ts"),
    "@/lib/drivers/phase6Policy":load("../drivers/phase6Policy.ts"),
    "@/lib/finance/phase5Fare":load("../finance/phase5Fare.ts"),
    "@/lib/finance/phase2Policy":load("../finance/phase2Policy.ts",{},env),
    "@/lib/release/releaseFlags":load("../release/releaseFlags.ts",{},env),
    "@/lib/notifications/outboxDelivery":{isOutboxDeliveryEnabled:()=>false},
  },env);
}

test("operational counts use four independent exact filters beyond the normal row limit",async()=>{
  const rows = [...Array.from({length:1300},()=>({status:"pending_payment_review",payment_type:"combined"})),
    {status:"pending_payment_review",payment_type:"commission"},{status:"waiting_confirmation",payment_type:"combined"}];
  let reads = 0;
  const db = {from(table:string){
    let scoped=table==="driver_payment_requests" ? rows : [];
    const query = {
      select:(_:string,options:{count:string;head:boolean})=>{assert.equal(options.count,"exact");assert.equal(options.head,true);return query;},
      eq:(field:"status",value:string)=>{scoped=scoped.filter(row=>row[field]===value);return query;},
      in:(field:"payment_type"|"status",values:string[])=>{scoped=scoped.filter(row=>values.includes(row[field]));return query;},
      then:(resolve:(result:unknown)=>void)=>{reads++;resolve({count:scoped.length,data:null,error:null});},
    };
    return query;
  }};
  const handler=route("operational-counts",{"@/lib/auth/admin":role("support",db),
    "@/lib/admin/operationalCounts":queues,"@/lib/admin/applicationSummary":{PHASE6_NEEDS_REVIEW:["SUBMITTED"]},
    "@/lib/admin/yocoFulfilment":{readYocoFulfilment:async()=>{throw Error("unavailable");}}});
  const result=await (await handler.GET(request())).json();
  assert.deepEqual(result.paymentQueues,{pendingProofs:1301,awaitingConfirmation:1,subscriptionProofs:1300,commissionProofs:1301});
  assert.equal(result.pendingApplicationReviews,0); assert.equal(result.yocoTripPaymentExceptions,null);
  assert.equal(reads,5);
});

test("surge POST rejects malformed input before writing and binds all existing roles to the authenticated actor",async()=>{
  for(const user of ["owner","admin","dispatcher","support"]) {
    const writes:unknown[][]=[];
    const handler=route("pricing/surge",{"@/lib/auth/admin":role(user),"@/lib/domain/fare":fare,
      "@/lib/pricing/manualSurgeServer":{setActiveManualSurge:async (...values:unknown[])=>{
        writes.push(values);return {ok:true,surge:fare.SURGE_MODES.normal};
      }}});
    const send=(body:unknown)=>handler.POST(new Request("https://local.invalid/",{method:"POST",body:JSON.stringify(body)}));
    for (const body of [{},{mode:"invalid"},{mode:["normal"]},null]) assert.equal((await send(body)).status,400);
    assert.equal(writes.length,0);
    assert.equal((await send({mode:"normal",updatedBy:"forged"})).status,200);
    assert.deepEqual(writes,[["normal","authenticated"]]);
  }
});

test("surge transport rejects network failures, malformed confirmation and timeouts",async()=>{
  const { requestSurge }=await import(new URL("./surgeRequest.ts",import.meta.url).href) as typeof import("./surgeRequest");
  const signal=new AbortController().signal;
  await assert.rejects(requestSurge(async()=>"token",signal,"normal",async()=>{throw Error("offline");}),/offline/);
  await assert.rejects(requestSurge(async()=>"token",signal,"normal",async()=>Response.json({ok:true,state:"configured",surge:{mode:"other",multiplier:1,label:"Other"}})),/unavailable/);
  const hold=setTimeout(()=>{},50);
  try {
    await assert.rejects(requestSurge(async()=>"token",signal,"normal",()=>new Promise(()=>{}),5),/timed out/);
  } finally { clearTimeout(hold); }
  const saved={ok:true,state:"absent",surge:{mode:"normal",multiplier:1,label:"Normal"}};
  assert.deepEqual(await requestSurge(async()=>"token",signal,undefined,async()=>Response.json(saved)),saved);
});

test("policy is allowlisted across four roles and distinguishes missing and failed authority",async()=>{
  const policy={version:"v1",effective_from:"2026-01-01",membership_price_cents:9900,membership_days:30,go_service_fee_cents:300,
    go_xl_service_fee_cents:500,currency:"ZAR",active:true, secret:"hidden"};
  for(const user of ["owner","admin","dispatcher","support",null]) {
    const calls:string[]=[];
    const db={rpc:async(name:string)=>{calls.push(name);return {data:policy,error:null};}};
    const handler=managementRoute(user,db,{MOOVU_PHASE6_NEW_WORK_ELIGIBILITY:"enabled",MOOVU_PHASE2_FINANCE_MODE:"invalid sentinel"});
    const result=await handler.GET(request());
    if (user===null) { assert.equal(result.status,401);assert.equal(calls.length,0);continue; }
    const data=await result.json();
    assert.equal(result.status,200);
    assert.deepEqual(calls,["phase5_policy_at"]);
    assert.equal(data.observed.state,"observed");
    assert.equal(data.observed.value.secret,undefined);
    assert.equal(data.features.phase6Eligibility,true);
    assert.equal(data.features.eligibilityConfiguration,"configured");
    assert.equal(data.features.outboxConfiguration,"absent");
    assert.equal(Boolean(data.commission),["owner","admin"].includes(user));
    assert.equal(JSON.stringify(data).includes("invalid sentinel"),false);
  }
  for (const [payload,state] of [[{data:null,error:null},"absent"],[{data:null,error:"unavailable"},"unavailable"],[{data:{version:"incomplete"},error:null},"malformed"]] as const) {
    const result=await managementRoute("admin",{rpc:async()=>payload}).GET(request());
    assert.equal((await result.json()).observed.state,state);
  }
});

test("activity denies restricted reads before querying and pages safe records with stable identity",async()=>{
  for(const user of ["support","dispatcher"]) {
    const handler=managementRoute(user,{from:()=>assert.fail("Restricted evidence queried")});
    for(const section of ["onboarding","proofs","settlements","memberships","cancellations"]) {
      assert.equal((await handler.GET(request(`?section=${section}`))).status,403);
    }
  }
  for (const [source, sample, link] of [
    ["onboarding",{application_id:"application",source_version:2,action:"APPROVED"},"/admin/onboarding?id=application"],
    ["linking",{event_type:"driver_link_unlink",driver_id:null},null],
    ["proofs",{status:"approved",payment_type:"combined",pop_file_url:"secret proof"},"/admin/payment-receipts/id"],
    ["settlements",{driver_id:"driver",amount_paid:5,operation_key:"op"},"/admin/drivers/driver"],
    ["memberships",{status:"APPROVED",financial_transaction_id:"tx"},"/admin/moovu-plus"],
    ["cancellations",{assessment_id:"assessment",action_type:"WAIVER",phase4_fee_assessments:{trip_id:"trip"}},"/admin/trips/trip"],
  ] as const) {
    const orders:string[] = [];
    const query = {
      select:()=>query,not:()=>query,in:()=>query,
      order:(field:string)=>{orders.push(field);return query;},
      range:async(from:number,to:number)=>{
        assert.equal(from,25);assert.equal(to,49);
        return {data:[{id:"id",created_at:"same",...sample}],count:26,error:null};
      },
    };
    const handler=managementRoute("owner",{from:()=>query});
    const result=await handler.GET(request(`?section=${source}&page=2`));
    const data=await result.json();
    assert.equal(result.status,200);
    assert.equal(orders.at(-1),"id");
    assert.equal(data.rows[0].id,"id");
    assert.equal(data.rows[0].actor,null);
    assert.equal(data.rows[0].href,link);
    assert.equal(JSON.stringify(data).includes("secret proof"),false);
  }
});

test("Maps telemetry and recovery summaries are independently scoped",async()=>{
  const maps=route("maps/usage",{"@/lib/auth/admin":role("support",{rpc:async()=>{throw Error("missing");}}),
    "@/lib/server/mapsCostControl":{getLocalMapsCostSnapshot:()=>({generatedAt:"now",operations:{route:{providerSuccesses:2,providerFailures:1,providerCallsLastMinute:0,secret:"omit"}}})}});
  const telemetry=await (await maps.GET(request("?summary=1"))).json();
  assert.equal(telemetry.local.operations.route.providerSuccesses,2);
  assert.equal(telemetry.local.operations.route.secret,undefined);
  assert.equal(telemetry.shared,null);
  const order:string[]=[];
  const query={
    select:(fields:string)=>{assert.doesNotMatch(fields,/last_error|payload/);return query;},
    order:(field:string)=>{order.push(field);return query;},
    limit:async(limit:number)=>{assert.equal(limit,100);return {data:[{id:"job",trip_id:"trip"}],error:null};},
  };
  const restricted=route("phase2-finance/recovery",{"@/lib/auth/admin":role("owner",{from:()=>query})});
  const jobs=await (await restricted.GET(request("?summary=1"))).json();
  assert.deepEqual(order,["created_at","id"]);
  assert.equal(jobs.scope,"recent");assert.equal(jobs.limit,100);assert.equal(jobs.total,undefined);
  assert.equal(jobs.jobs[0].trip_id,"trip");
});
