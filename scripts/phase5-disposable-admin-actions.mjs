import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const url=process.env.PHASE3_E2E_SUPABASE_URL,key=process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url&&key);assert.equal(new URL(url).hostname.split('.')[0],'tangtlmdpnvmoviwrgvd');
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const marker=crypto.randomUUID();
const customer=await db.from('customers').select('id').limit(1).single();assert.ifError(customer.error);
const admin=await db.from('profiles').select('id').in('role',['owner','admin']).limit(1).single();assert.ifError(admin.error);
const source=crypto.randomUUID();const issued=await db.rpc('phase5_issue_credit',{p_customer_id:customer.data.id,p_amount_cents:700,p_source_type:'ADMIN_ADJUSTMENT',p_source_id:source,p_policy_version:'phase5-disposable-owner-v1',p_idempotency_key:`e2e:reversal:${marker}`,p_actor_id:admin.data.id,p_reason:'Disposable reversal validation'});assert.ifError(issued.error);
const reversed=await db.rpc('phase5_reverse_credit',{p_issuance_id:issued.data.issuance_id,p_actor_id:admin.data.id,p_reason:'Disposable reversal validation'});assert.ifError(reversed.error);assert.equal(reversed.data.replayed,false);
const replay=await db.rpc('phase5_reverse_credit',{p_issuance_id:issued.data.issuance_id,p_actor_id:admin.data.id,p_reason:'Disposable reversal validation'});assert.ifError(replay.error);assert.equal(replay.data.replayed,true);
const payment=await db.rpc('phase5_submit_membership_payment',{p_customer_id:customer.data.id,p_reference:`REJECT-${marker.slice(0,8)}`,p_proof_path:'',p_submission_key:crypto.randomUUID()});assert.ifError(payment.error);
const rejected=await db.rpc('phase5_reject_membership_payment',{p_payment_id:payment.data.payment_id,p_actor_id:admin.data.id,p_reason:'Disposable rejection validation'});assert.ifError(rejected.error);assert.equal(rejected.data.replayed,false);
const rejectReplay=await db.rpc('phase5_reject_membership_payment',{p_payment_id:payment.data.payment_id,p_actor_id:admin.data.id,p_reason:'Disposable rejection validation'});assert.ifError(rejectReplay.error);assert.equal(rejectReplay.data.replayed,true);
const imbalance=await db.from('financial_transactions').select('id,financial_ledger_entries(entry_side,amount_cents)').in('id',[issued.data.financial_transaction_id,reversed.data.financial_transaction_id]);assert.ifError(imbalance.error);
for(const tx of imbalance.data){const debit=tx.financial_ledger_entries.filter(e=>e.entry_side==='DEBIT').reduce((s,e)=>s+Number(e.amount_cents),0);const credit=tx.financial_ledger_entries.filter(e=>e.entry_side==='CREDIT').reduce((s,e)=>s+Number(e.amount_cents),0);assert.equal(debit,credit);}
console.log('PHASE 5 DISPOSABLE ADMIN ACTIONS PASSED');
