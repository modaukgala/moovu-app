import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const { ADMIN_TRIP_PAYMENT_METHODS, isAdminTripPaymentMethod } = await import(
  new URL("./adminTripPaymentMethod.ts", import.meta.url).href
) as typeof import("./adminTripPaymentMethod");

test("new Admin trips accept only cash and the legacy other method", () => {
  assert.deepEqual(ADMIN_TRIP_PAYMENT_METHODS, ["cash", "other"]);
  assert.equal(isAdminTripPaymentMethod("cash"), true);
  assert.equal(isAdminTripPaymentMethod("other"), true);
  assert.equal(isAdminTripPaymentMethod("online"), false);
  assert.equal(isAdminTripPaymentMethod("ONLINE"), false);
  assert.equal(isAdminTripPaymentMethod(""), false);
});

test("Admin create-trip API rejects online before any route or database work", async () => {
  let routeCalls = 0;
  const source = readFileSync(new URL("../../app/api/admin/trips/create/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { POST?: (request: { json: () => Promise<unknown> }) => Promise<{ status: number; body: { error?: string } }> } = {};
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/auth/admin": { requireAdminUser: async () => ({ ok: true, user: { id: "admin" }, supabaseAdmin: {} }) },
    "@/lib/fare/calculateFare": {},
    "@/lib/domain/fare": { normalizeRideOptionId: () => "go" },
    "@/lib/pricing/manualSurgeServer": {},
    "@/lib/maps/routeService": { calculateDrivingRoute: async () => { routeCalls++; return null; } },
    "@/lib/maps/mapRequestPolicy": { isValidLatitude: () => true, isValidLongitude: () => true },
    "@/lib/server/hardenedRpc": {},
    "@/lib/trips/adminTripPaymentMethod": { isAdminTripPaymentMethod },
  };
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
    console,
  });
  const request = (paymentMethod: string) => ({ json: async () => ({
    pickup: "Pickup", dropoff: "Dropoff", pickupLat: -25, pickupLng: 28,
    dropoffLat: -25.1, dropoffLng: 28.1, paymentMethod,
  }) });

  const online = await exports.POST!(request("online"));
  assert.equal(online.status, 400);
  assert.equal(online.body.error, "Invalid payment method.");
  assert.equal(routeCalls, 0);

  for (const method of ["cash", "other"]) {
    const accepted = await exports.POST!(request(method));
    assert.equal(accepted.status, 503);
    assert.equal(accepted.body.error, "A verified route is unavailable. Please retry before creating this trip.");
  }
  assert.equal(routeCalls, 2);
});

test("customer booking accepts cash and online while rejecting unknown payment methods", async () => {
  const source = readFileSync(new URL("../../app/api/customer/book-trip/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { POST?: (request: { json: () => Promise<unknown> }) => Promise<{ status: number; body: { error?: string } }> } = {};
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/fare/calculateFare": {},
    "@/lib/domain/fare": { MAX_TRIP_STOPS: 4, normalizeRideOptionId: () => "go", getRideOption: () => ({}) },
    "@/lib/pricing/manualSurgeServer": {},
    "@/lib/dispatch/dispatchTrip": {},
    "@/lib/customer/auth": {},
    "@/lib/customer/server": { getAuthenticatedCustomer: async () => ({ ok: true, customer: { id: "customer-1", status: "active" }, supabaseAdmin: {} }) },
    "@/lib/server/phase4Rpc": { callPhase4Rpc: async () => ({ ok: true, result: { booking_blocked: false } }) },
    "@/lib/finance/phase5Fare": { calculatePhase5Fare: () => ({}) },
    "@/lib/push-notify": {},
    "@/lib/maps/routeService": {},
    "@/lib/maps/mapRequestPolicy": {},
    "@/lib/maps/routeQuote": {},
  };
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
    console,
  });
  const request = (paymentMethod: string) => ({ json: async () => ({ paymentMethod }) });
  const cash = await exports.POST!(request("cash"));
  assert.equal(cash.body.error, "Pickup and destination are required.");
  const online = await exports.POST!(request("online"));
  assert.equal(online.body.error, "Pickup and destination are required.");
  const invalid = await exports.POST!(request("bank_card"));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "Invalid payment method.");
});
