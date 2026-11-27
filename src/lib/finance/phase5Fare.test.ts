import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types runner requires the explicit extension.
import { calculateTripFare, type FareInput } from "../domain/fare.ts";
// @ts-expect-error Node strip-types runner requires the explicit extension.
import { calculatePhase5Fare, phase5PolicyActive, phase5ServiceFeeCents } from "./phase5Fare.ts";

test("only a real active Phase 5 policy enables separate service fees", () => {
  assert.equal(phase5PolicyActive(null), false);
  assert.equal(phase5PolicyActive({ version: null, active: null }), false);
  assert.equal(phase5PolicyActive({ version: "synthetic", active: false }), false);
  assert.equal(phase5PolicyActive({ version: "synthetic", active: true }), true);
});

const base = { distanceKm: 5, durationMin: 10, rideOptionId: "go" as const,
  surgeMultiplier: 1, activeMember: false, availableCreditCents: 0 };
const phase5 = (input: FareInput & { rideOptionId: "go" | "group"; activeMember: boolean; availableCreditCents: number }) => calculatePhase5Fare({
  rideFareCents: calculateTripFare({ ...input, includeEmbeddedBookingFee: false }).totalFare * 100,
  rideOptionId: input.rideOptionId,
  activeMember: input.activeMember,
  availableCreditCents: input.availableCreditCents,
});

test("legacy fare retains embedded R4 while Phase 5 calculates a separate R3", () => {
  const legacy = calculateTripFare(base);
  const modern = phase5(base);
  assert.equal(legacy.bookingFee, 4);
  assert.equal(modern.grossServiceFeeCents, 300);
  assert.equal(modern.customerTotalCents, modern.rideFareCents + 300);
  assert.equal(modern.driverFareBasisCents, modern.rideFareCents);
  assert.equal(calculateTripFare({ ...base, includeEmbeddedBookingFee: false }).bookingFee, 0);
});

test("member waiver and promotional credit never reduce Driver basis", () => {
  const regular = phase5(base);
  const member = phase5({ ...base, activeMember: true, availableCreditCents: 1000 });
  assert.equal(member.membershipWaiverCents, 300);
  assert.equal(member.promotionalCreditCents, 1000);
  assert.equal(member.customerTotalCents, regular.rideFareCents - 1000);
  assert.equal(member.driverFareBasisCents, regular.driverFareBasisCents);
});

test("Go XL fee, minimum fare and surge remain deterministic", () => {
  const input = { ...base, rideOptionId: "group" as const, distanceKm: 0, durationMin: 0,
    surgeMultiplier: 1.4 };
  const regular = phase5(input);
  const member = phase5({ ...input, activeMember: true, availableCreditCents: 0 });
  assert.equal(regular.grossServiceFeeCents, 500);
  assert.equal(regular.rideFareCents, 9800);
  assert.equal(regular.customerTotalCents, 10300);
  assert.equal(member.customerTotalCents, 9800);
  assert.equal(member.driverFareBasisCents, regular.driverFareBasisCents);
});

test("credit is capped at Customer charges and rejects invalid balances", () => {
  const result = phase5({ ...base, availableCreditCents: 1_000_000 });
  assert.equal(result.customerTotalCents, 0);
  assert.equal(result.promotionalCreditCents, result.rideFareCents + 300);
  assert.throws(() => phase5({ ...base, availableCreditCents: -1 }));
});

test("tiered booking fee covers the card fee on fare plus fee and keeps the flat minimum", () => {
  const fee = (rand: number, option: "go" | "group" = "go") => phase5ServiceFeeCents(rand * 100, option, 363) / 100;
  assert.equal(fee(41), 3);
  assert.equal(fee(82), 3);
  assert.equal(fee(83), 4);
  assert.equal(fee(110), 4);
  assert.equal(fee(111), 5);
  assert.equal(fee(137), 5);
  assert.equal(fee(138), 6);
  assert.equal(fee(165), 6);
  assert.equal(fee(166), 7);
  assert.equal(fee(60, "group"), 5);
  for (let rand = 1; rand <= 600; rand += 1) {
    const f = fee(rand);
    assert.ok(f * 100 >= Math.ceil((rand + f) * 3.5), `fee ${f} covers 3.5% of R${rand + f}`);
  }
  assert.equal(phase5ServiceFeeCents(20000, "go", null), 300);
});
