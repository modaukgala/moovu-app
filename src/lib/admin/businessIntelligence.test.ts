import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { Trip } from "./businessIntelligence";

function load<T>(relative: string, dependencies: Record<string,unknown> = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(relative,import.meta.url),"utf8"),{
    compilerOptions:{ module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 }
  }).outputText,{exports,URL,URLSearchParams,console,require:(name:string)=>dependencies[name]});
  return exports as T;
}
const metrics = load<typeof import("./earningsMetrics")>("./earningsMetrics.ts");
const bi = load<typeof import("./businessIntelligence")>("./businessIntelligence.ts",{"./earningsMetrics":metrics});
const bounded = load<typeof import("./boundedRetrieval")>("./boundedRetrieval.ts");
const plain = <T>(data:T):T => JSON.parse(JSON.stringify(data));
const trip = (row:Partial<Trip>):Trip => ({
  id:"t",created_at:"2026-11-24T22:00:00Z",completed_at:null,cancelled_at:null,status:"requested",
  customer_id:null,customer_auth_user_id:null,driver_id:null,ride_option:null,payment_method:null,
  actual_distance_km:null,actual_duration_min:null,cancelled_by:null,cancellation_reason:null,...row,
});

test("Johannesburg periods, midnight, weekday and distinct event timestamps",()=>{
  const now=new Date("2026-11-25T05:00:00Z");
  const today=bi.biPeriod(new URLSearchParams("preset=today"),now);
  assert.equal(today.start,"2026-11-24T22:00:00.000Z");
  assert.equal(today.partial,true);
  const prior=bi.biPeriod(new URLSearchParams("preset=previousMonth"),now);
  assert.equal(prior.days,31);
  assert.equal(prior.previous.end,prior.start);
  assert.equal(prior.partial,false);
  assert.equal(bi.change(12,0,true),null);
  assert.equal(bi.change(12,10,false),null);
  assert.equal(bi.change(12,10,true),20);
  assert.throws(()=>bi.biPeriod(new URLSearchParams("preset=custom&from=2026-11-27&to=2026-11-25"),now));
  assert.throws(()=>bi.biPeriod(new URLSearchParams("preset=custom&from=2026-02-30&to=2026-03-01"),now));
  const series=bi.tripSeries([trip({ride_option:"group"})],[trip({created_at:"2026-11-20T10:00:00Z",completed_at:"2026-11-25T04:00:00Z",ride_option:"legacy",driver_id:"d"})],[],today);
  assert.equal(series.hours[0],1); assert.equal(series.weekdays[3],1);
  assert.equal(series.days[0].completed,1); assert.equal(series.days[0].drivers,1);
  assert.equal(series.categories["Go XL"],1); assert.equal(series.completedCategories.Unknown,1);
});

test("customer links deduplicate trips, reconcile Auth-only rides and flag gaps and conflicts",()=>{
  const linked=trip({id:"1",customer_id:"p",customer_auth_user_id:"a"});
  const auth=trip({id:"2",customer_auth_user_id:"a"});
  assert.deepEqual(plain(bi.customerActivity([linked,auth,linked],[{ id:"p",auth_user_id:"a" }],true)),
    {identified:1,matched:2,conflicts:0,unresolved:0,repeat:100});
  const incomplete=bi.customerActivity([linked,trip({id:"3",customer_id:"p",customer_auth_user_id:"other"}),trip({id:"4"})],[{id:"p",auth_user_id:"a"}],true);
  assert.equal(incomplete.repeat,null); assert.equal(incomplete.conflicts,1); assert.equal(incomplete.unresolved,1);
});

test("offer evidence preserves unresolved outcomes and excludes invalid and negative intervals",()=>{
  const t="2026-11-25T00:00:00Z", first={id:"a",trip_id:"t",offered_at:"2026-11-25T00:01:00Z",responded_at:"2026-11-25T00:02:00Z",status:"accepted"};
  const result=bi.offerEvidence([first,first,{...first,id:"b",status:"declined"},{...first,id:"c",status:"expired"},{...first,id:"d",status:"pending",offered_at:"invalid"},{...first,id:"e",trip_id:"missing",responded_at:t}],new Map([["t",t]]),"2026-11-25T12:00:00Z");
  assert.equal(result.issued,5);
  assert.deepEqual(plain(result.outcomes),{accepted:2,declined:1,expired:1,unresolved:1});
  assert.equal(result.first.average,1); assert.equal(result.accepted.average,2); assert.equal(result.accepted.usable,1);
  assert.equal(bi.offerEvidence([],new Map(),t).first.average,null);
});

test("aggregate CSV preserves zero, unavailable, quoting and formula safety",()=>{
  const period=bi.biPeriod(new URLSearchParams("preset=today"),new Date("2026-11-25T06:00:00Z"));
  const csv=bi.aggregateCsv(period,[bi.metric('  =SUM(1,2)"',0),bi.metric("Unknown",null)]);
  assert.match(csv, /Africa\/Johannesburg/);
  assert.ok(csv.includes('"\'  =SUM(1,2)"""')); assert.ok(csv.includes('"0"')); assert.ok(csv.includes('"Unavailable"'));
});

test("actual BI route is authenticated and serves operational-only reads for all Admin roles",async()=>{
  for (const role of [null,"owner","admin","dispatcher","support"]) {
    const tables:string[] = [];
    const driverless=trip({id:"a",status:"completed",completed_at:new Date().toISOString()});
    const db={from(name:string){
      tables.push(name);
      let field="";
      const query={select:()=>query,gte:(key:string)=>{field=key;return query;},lt:()=>query,eq:()=>query,order:()=>query,
        range:async()=>field==="completed_at" ? {data:[driverless],count:1,error:null} : {data:[],count:0,error:null}};
      return query;
    }};
    const { GET }=load<{GET:(request:Request)=>Promise<Response>}>("../../app/api/admin/business-intelligence/route.ts",{
      "next/server":{NextResponse:Response},"@/lib/auth/admin":{requireAdminUser:async()=>role ? {ok:true,profile:{role},supabaseAdmin:db}:{ok:false,status:401,error:"Unauthorized"}},
      "@/lib/admin/businessIntelligence":bi,"@/lib/admin/boundedRetrieval":bounded,
    });
    const res=await GET(new Request("https://local.invalid/?preset=today&financial=true"));
    assert.equal(res.status,role ? 200 : 401);
    if (!role) assert.equal(tables.length,0);
    else {
      const result=await res.json();
      assert.equal(result.financial,undefined);
      assert.equal(result.service.find((row:{label:string})=>row.label==="Completed trips without driver").value,1);
      assert.equal(result.service.find((row:{label:string})=>row.label==="Recorded offers issued").value,null);
      assert.ok(tables.every(name=>name==="trips" || name==="driver_trip_offers"));
    }
  }
});

test("dashboard sums reject truncated or duplicate rows while preserving zero and independent snapshot availability",()=>{
  assert.deepEqual(plain(bi.executiveMoney([{id:"a",fare_amount:0,commission_amount:null}],1)),{gross:0,commission:null,average:0});
  assert.deepEqual(plain(bi.executiveMoney([{id:"a",fare_amount:10,commission_amount:1}],2)),{gross:null,commission:null,average:null});
  assert.equal(bi.executiveMoney([{id:"a",fare_amount:10},{id:"a",fare_amount:10}],2).gross,null);
  assert.equal(bi.executiveMoney([{id:"a",fare_amount:"49.00",commission_amount:"6.90"}],1).gross,49);
});
