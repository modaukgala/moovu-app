import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const url=process.env.PHASE3_E2E_SUPABASE_URL,key=process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url&&key); assert.equal(new URL(url).hostname.split(".")[0],"tangtlmdpnvmoviwrgvd");
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:candidates,error}=await db.from("customers").select("id,auth_user_id").limit(10); assert.ifError(error);
const completed=await db.from("trips").select("customer_id").eq("status","completed"); assert.ifError(completed.error);
const used=new Set((completed.data??[]).map(row=>row.customer_id));
const relationships=await db.from("phase5_referral_relationships").select("referee_customer_id"); assert.ifError(relationships.error);
const referred=new Set((relationships.data??[]).map(row=>row.referee_customer_id));
const eligible=(candidates??[]).filter(row=>!used.has(row.id)&&!referred.has(row.id)); assert.ok(eligible.length>=2,"Two fresh Customers without completed trips are required.");
const [referrer,referee]=eligible;
const codeResult=await db.rpc("phase5_ensure_referral_code",{p_customer_id:referrer.id}); assert.ifError(codeResult.error);
const accepted=await db.rpc("phase5_accept_referral",{p_referee_customer_id:referee.id,p_code:codeResult.data}); assert.ifError(accepted.error);
const state=await db.rpc("phase5_customer_state",{p_customer_id:referee.id});assert.ifError(state.error);
const expected=Math.max(0,10000+(state.data.membership_active?0:300)-Number(state.data.available_credit_cents));
const booking=await db.rpc("phase5_create_trip",{p_customer_id:referee.id,p_actor_id:referee.auth_user_id,
  p_booking_key:crypto.randomUUID(),p_trip_payload:{customer_id:referee.id,status:"requested",payment_method:"cash",ride_option:"go",
    pickup_address:"Referral test",dropoff_address:"Referral test",distance_km:5,duration_min:10,start_otp:"1111",end_otp:"2222"},
  p_ride_fare_cents:10000,p_ride_option:"go",p_expected_customer_total_cents:expected}); assert.ifError(booking.error);
const tripId=booking.data.trip.id;
const terminal=await db.from("trips").update({status:"completed",completed_at:new Date().toISOString()}).eq("id",tripId); assert.ifError(terminal.error);
const attempts=await Promise.all([1,2].map(()=>db.rpc("phase5_qualify_referral",{p_trip_id:tripId,p_actor_id:referee.auth_user_id})));
for(const attempt of attempts)assert.ifError(attempt.error);
assert.deepEqual(attempts.map(attempt=>attempt.data.replayed).sort(),[false,true]);
const rewards=await db.from("phase5_credit_issuances").select("customer_id,amount_cents,source_type").eq("source_id",accepted.data.relationship_id); assert.ifError(rewards.error);
assert.deepEqual((rewards.data??[]).map(row=>Number(row.amount_cents)).sort((a,b)=>a-b),[1000,2000]);
console.log("PHASE 5 DISPOSABLE REFERRAL E2E PASSED");
