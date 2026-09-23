import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { calculateAddStopIncrease, calculateFinalJourneyFare, calculateTripFare, normalizeRideOptionId } from "@/lib/domain/fare";
import { calculatePhase5Fare } from "@/lib/finance/phase5Fare";
import { createRouteSignature } from "@/lib/maps/mapRequestPolicy";
import { verifyRouteQuote } from "@/lib/maps/routeQuote";
import { getActiveManualSurge } from "@/lib/pricing/manualSurgeServer";

type Point = { lat: number; lng: number };
const finitePoint = (value: unknown): value is Point => typeof value === "object" && value !== null &&
  Number.isFinite(Number((value as Point).lat)) && Number.isFinite(Number((value as Point).lng));

export async function POST(req: Request) {
  const auth = await getAuthenticatedCustomer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null);
  const pickup = body?.pickup; const dropoff = body?.dropoff;
  const stops = Array.isArray(body?.stops) ? body.stops.filter(finitePoint).slice(0, 2) : [];
  if (!finitePoint(pickup) || !finitePoint(dropoff)) return NextResponse.json({ ok: false, error: "Verified route points are required." }, { status: 400 });
  const signature = createRouteSignature({ origin: pickup, destination: dropoff, waypoints: stops, travelMode: "driving" });
  const route = verifyRouteQuote(String(body?.routeQuote ?? ""), signature);
  if (!route) return NextResponse.json({ ok: false, error: "Route quote expired. Recalculate the route." }, { status: 409 });
  const { data: policy, error: policyError } = await auth.supabaseAdmin.rpc("phase5_policy_at", { p_at: new Date().toISOString() });
  if (policyError) return NextResponse.json({ ok: false, error: "Pricing authority is unavailable." }, { status: 503 });
  if (!policy) return NextResponse.json({ ok: true, authority: "LEGACY" });
  const [{ data: state, error: stateError }, surge] = await Promise.all([
    auth.supabaseAdmin.rpc("phase5_customer_state", { p_customer_id: auth.customer.id }), getActiveManualSurge(),
  ]);
  if (stateError) return NextResponse.json({ ok: false, error: "Customer benefits are unavailable." }, { status: 503 });
  const rideOptionId = normalizeRideOptionId(String(body?.rideOption ?? ""));
  const base = calculateTripFare({ distanceKm: route.originalDistanceKm, distanceDiscountKm: 0,
    durationMin: route.originalDurationMin, rideOptionId, surgeLabel: surge.mode,
    surgeMultiplier: surge.multiplier, includeEmbeddedBookingFee: false });
  const addStop = calculateAddStopIncrease({ rideOptionId, originalDistanceKm: route.originalDistanceKm,
    originalDurationMin: route.originalDurationMin, routeDistanceKm: route.distanceKm,
    routeDurationMin: route.durationMin, stopCount: stops.length, surgeMultiplier: surge.multiplier });
  const rideFare = calculateFinalJourneyFare({ baseFare: base, routeDistanceKm: route.distanceKm,
    addStopIncrease: addStop.finalAddStopIncrease }).totalFare;
  const quote = calculatePhase5Fare({ rideFareCents: Math.round(rideFare * 100), rideOptionId,
    activeMember: state?.membership_active === true, availableCreditCents: Number(state?.available_credit_cents ?? 0) });
  return NextResponse.json({ ok: true, authority: "PHASE5", quote, policyEffectiveFrom: policy.effective_from,
    membershipExpiresAt: state?.membership_expires_at ?? null });
}
