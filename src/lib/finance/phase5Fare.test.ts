import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types runner requires the explicit extension.
import { calculateTripFare, type FareInput } from "../domain/fare.ts";
// @ts-expect-error Node strip-types runner requires the explicit extension.
import { calculatePhase5Fare } from "./phase5Fare.ts";

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
