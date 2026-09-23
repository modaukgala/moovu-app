import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r/g, "");
const identity = read("docs/p0-customer-identity-recovery.sql");
const reservation = read("docs/p0-dispatch-authority-recovery.sql");
const bundle = read("docs/p0-production-recovery.sql");
const booking = read("src/app/api/customer/book-trip/route.ts");

test("P0 forward bundle is atomic and contains only the reviewed forward repairs", () => {
  assert.equal((bundle.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((bundle.match(/^commit;$/gm) ?? []).length, 1);
  for (const file of ["p0-customer-identity-recovery.sql", "p0-booking-defaults-recovery.sql", "p0-dispatch-authority-recovery.sql"]) {
    assert.ok(bundle.includes(read(`docs/${file}`).replace(/^begin;\n/m, "").replace(/^commit;\n?/m, "")));
  }
  assert.doesNotMatch(bundle, /truncate|delete from|drop table|drop column|disable row level security/i);
});

test("P0 actor repair uses canonical Auth identities and explicit customer privilege", () => {
  assert.match(identity, /values\(new\.auth_user_id,'customer'/);
  assert.match(identity, /select c\.auth_user_id,'customer'/);
  assert.match(identity, /join auth\.users u on u\.id=c\.auth_user_id/);
  assert.match(identity, /on conflict\(id\) do nothing/);
  assert.match(identity, /revoke all on function[^;]+from public,anon,authenticated/);
  assert.doesNotMatch(identity, /gen_random_uuid|uuid_generate|update public\.profiles|insert into auth\.users/i);
});

test("P0 reservation reuses finance authority and preserves established XL class", () => {
  const finance = reservation.split("$newfinance$")[1];
  assert.match(finance, /public\.phase2_finance_eligibility\(p_driver_id\)/);
  assert.doesNotMatch(finance, /subscription_status|balance_due/);
  assert.match(reservation, /v_required_seats=6 and v_driver\.seating_capacity<>7/);
  assert.match(reservation, /o\.dispatch_cycle>=greatest\(1,p_dispatch_cycle\)/);
  assert.match(reservation, /debt_limit_cents=5000/);
  assert.match(reservation, /go_basis_points=1500 and go_xl_basis_points=1500/);
});

test("P0 booking replay uses persisted OTPs and hides failed dispatch details", () => {
  assert.match(booking, /otp: \{ startOtp: trip\.start_otp, endOtp: trip\.end_otp \}/);
  assert.doesNotMatch(booking, /otp: \{ startOtp, endOtp \}/);
  assert.match(booking, /autoOfferResult:[\s\S]*hasOkFlag\(autoOfferResult\)[\s\S]*!autoOfferResult\.ok[\s\S]*error: "We're still searching for an available driver\."/);
});
