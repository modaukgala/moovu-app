import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
// @ts-expect-error Node strip-types uses explicit extensions.
import { findRegistrationIdentity, normalizeRegistrationPhone, registrationFailure, isMissingCustomerEmail } from "./registration.ts";

test("South African phone variants share the existing canonical storage format",()=>{
  for(const phone of ["0646068573","+27646068573","27646068573","064 606 8573"]) {
    assert.equal(normalizeRegistrationPhone(phone),"0646068573");
  }
  for(const phone of [null,"abc0646068573","064606857312","+123456789012","0000000000","064+6068573"]) {
    assert.equal(normalizeRegistrationPhone(phone),null);
  }
});

test("identity lookup finds users after page one and stops on a match",async()=>{
  const calls:number[]=[];
  const result=await findRegistrationIdentity(async({page,perPage}:{page:number;perPage:number})=>{
    calls.push(page);assert.equal(perPage,1000);
    return {data:{users:page===1?Array.from({length:1000},(_,i)=>({id:String(i),email:`dummy${i}@example.invalid`})):[{id:"owner",email:"owner@example.invalid"}]},error:null};
  },"OWNER@example.invalid");
  assert.equal(result.user?.id,"owner");assert.deepEqual(calls,[1,2]);
});

test("incomplete or failed identity scans fail closed",async()=>{
  const failed=await findRegistrationIdentity(async()=>({data:{users:[]},error:{code:"unavailable"}}),"test@example.invalid");
  assert.ok(failed.error);
  let calls=0;
  const capped=await findRegistrationIdentity(async()=>{calls++;return {data:{users:Array.from({length:1000},()=>({id:"dummy"}))},error:null};},"test@example.invalid");
  assert.equal(calls,10);assert.ok(capped.error);assert.equal(capped.user,null);
});

test("canonical email wins over editable legacy aliases on earlier pages",async()=>{
  const result=await findRegistrationIdentity(async({page}:{page:number})=>({data:{users:page===1?
    Array.from({length:1000},(_,i)=>({id:String(i),email:`alias${i}@example.invalid`,user_metadata:{customer_email:i===0?"owner@example.invalid":""}})):
    [{id:"owner",email:"owner@example.invalid"}]},error:null}),"owner@example.invalid");
  assert.equal(result.user?.id,"owner");
});

test("known failures are safe and uniqueness errors never trigger a legacy-column retry",()=>{
  assert.equal(registrationFailure({code:"email_exists"}).status,409);
  assert.equal(registrationFailure({code:"email_not_confirmed"}).status,403);
  assert.equal(registrationFailure({code:"unexpected_failure",message:"private database detail"}).status,503);
  assert.doesNotMatch(JSON.stringify(registrationFailure({message:"private database detail"})),/private database detail/);
  assert.equal(isMissingCustomerEmail({code:"23505",message:"duplicate customers_email_lower_unique"}),false);
  assert.equal(isMissingCustomerEmail({code:"PGRST204",message:"Could not find the email column"}),true);
});

test("registration does not mutate existing Auth identities or confirm phone ownership",()=>{
  const route=readFileSync("src/app/api/customer/register/route.ts","utf8");
  assert.doesNotMatch(route,/updateUserById|deleteUser|phone_confirm\s*:\s*true/);
  assert.match(route,/findRegistrationIdentity/);
  assert.doesNotMatch(route,/console\.error\([^\n]*, error\)/);
  const server=readFileSync("src/lib/customer/server.ts","utf8");
  assert.match(server,/actor\.data\.role !== "customer"/);
  assert.match(server,/if \(driver\.data/);
});
