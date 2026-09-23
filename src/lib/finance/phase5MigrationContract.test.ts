import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("docs/phase-5-customer-monetisation-migration.sql", "utf8");
const atomicSql = readFileSync("docs/phase-5-atomic-operations.sql", "utf8");
const bookingFixSql = readFileSync("docs/phase-5-booking-defaults-fix.sql", "utf8");

test("Phase 5 policy is immutable, versioned and installed dormant", () => {
  assert.match(sql, /create table if not exists public\.phase5_policies/i);
  assert.match(sql, /phase5_immutable_policy_trigger/i);
  assert.match(sql, /active boolean not null default false/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.phase5_policies/i);
  assert.doesNotMatch(sql, /not active or effective_from<=now/i);
});

test("Atomic booking locks Customer economics and fails on quote drift", () => {
  assert.match(atomicSql, /pg_advisory_xact_lock\(hashtextextended\('phase5-booking:'/i);
  assert.match(atomicSql, /PHASE5_QUOTE_CHANGED/i);
  assert.match(bookingFixSql, /insert into public\.trips \(%s\) select %s/i);
  assert.match(bookingFixSql, /into created using p_trip_payload/i);
  assert.match(atomicSql, /phase5_credit_redemptions/i);
});

test("Completion uses Driver snapshot and qualifies referrals in the same transaction", () => {
  assert.match(atomicSql, /t\.phase5_driver_fare_basis_cents::numeric\/100/i);
  assert.match(atomicSql, /perform public\.phase5_qualify_referral\(t\.id,p_actor_id\)/i);
  assert.match(atomicSql, /v_trip\.phase5_driver_fare_basis_cents/i);
});

test("Referral rewards and promotional postings are idempotent and non-cash", () => {
  assert.match(atomicSql, /'phase5:referrer:'\|\|rel\.id/i);
  assert.match(atomicSql, /'phase5:referee:'\|\|rel\.id/i);
  assert.match(atomicSql, /'non_cash',true/i);
  assert.match(atomicSql, /phase1_post_financial_transaction/i);
});

test("Phase 5 snapshot separates customer total from Driver fare basis", () => {
  for (const column of ["phase5_ride_fare_cents", "phase5_service_fee_cents", "phase5_membership_waiver_cents",
    "phase5_credit_cents", "phase5_customer_total_cents", "phase5_driver_fare_basis_cents"]) {
    assert.match(sql, new RegExp(column, "i"));
  }
  assert.match(sql, /phase5_driver_fare_basis_cents=phase5_ride_fare_cents/i);
});

test("Customer monetary tables use RLS and narrow RPC grants", () => {
  for (const table of ["phase5_membership_payments", "phase5_memberships", "phase5_credit_issuances",
    "phase5_credit_redemptions", "phase5_referral_relationships", "phase5_audit_events"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /grant execute on function public\.phase5_approve_membership_payment[^;]+to service_role/i);
  assert.doesNotMatch(sql, /phase5_approve_membership_payment[^;]+to authenticated/i);
});

test("Membership proof and approval remain separate and approval is replay safe", () => {
  assert.match(sql, /status text not null default 'SUBMITTED'/i);
  assert.match(sql, /if p\.status='APPROVED'/i);
  assert.match(sql, /phase1_post_financial_transaction\('phase5:membership:'/i);
  assert.match(sql, /expires_at=starts_at\+interval '30 days'/i);
});

test("Referral contract rejects self-referral and waits for completion", () => {
  assert.match(sql, /referrer_customer_id<>referee_customer_id/i);
  assert.match(sql, /Self-referral is not allowed/i);
  assert.match(sql, /Referral is only available before the first completed ride/i);
});

test("Cash service fee is separate, balanced and never recorded as MOOVU cash", () => {
  assert.match(atomicSql, /phase5_post_service_fee/i);
  assert.match(atomicSql, /'BOOKING_FEE','ADJUSTMENT'/i);
  assert.match(atomicSql, /'COMMISSION_RECEIVABLE','DRIVER'/i);
  assert.match(atomicSql, /'BOOKING_FEE_REVENUE','PLATFORM'/i);
  assert.match(atomicSql, /'cash_received_by_moovu',false/i);
  assert.match(atomicSql, /perform public\.phase5_post_service_fee\(t\.id,p_actor_id\)/i);
});

test("Phase 5 referral data does not alter legacy referral scaffolding", () => {
  assert.match(sql, /create table if not exists public\.phase5_referral_relationships/i);
  assert.doesNotMatch(sql, /create table if not exists public\.referral_relationships/i);
});
