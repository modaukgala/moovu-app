import type { SupabaseClient } from "@supabase/supabase-js";
import { DRIVER_COMMISSION_LOCK_LIMIT } from "@/lib/finance/commission";
import { DISPATCH_CONFIG } from "@/lib/dispatch/config";
import { haversineKm } from "@/lib/dispatch/driverScoring";
import type { DispatchCandidate, DispatchScoreBreakdown } from "@/lib/dispatch/types";

type CandidateRow = {
  id: string;
  status: string | null;
  verification_status: string | null;
  profile_completed: boolean | null;
  online: boolean | null;
  busy: boolean | null;
  lat: number | null;
  lng: number | null;
  last_seen: string | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
  seating_capacity: number | null;
  is_deleted: boolean | null;
};

type WalletRow = { driver_id: string; balance_due: number | null };
type QualityRow = {
  driver_id: string;
  avg_rating: number | null;
  quality_score: number | null;
  acceptance_rate: number | null;
};
type OfferStatsRow = {
  driver_id: string;
  offers_received: number | null;
  offers_accepted: number | null;
  offers_rejected: number | null;
  offers_missed: number | null;
  last_offer_at: string | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function compatibleCapacity(rideOption: string | null | undefined, seats: number | null) {
  const option = String(rideOption ?? "go").toLowerCase();
  const required = option === "group" || option === "xl" || option === "go_xl" ? 6 : 3;
  return Number(seats ?? 0) >= required;
}

function scoreCandidate(params: {
  distanceKm: number;
  quality?: QualityRow;
  stats?: OfferStatsRow;
  nowMs: number;
}) {
  const { distanceKm, quality, stats, nowMs } = params;
  const distance = clamp(68 - distanceKm * 7.5, 0, 68);
  const lastOfferMs = stats?.last_offer_at ? new Date(stats.last_offer_at).getTime() : 0;
  const idleMinutes = lastOfferMs > 0 ? Math.max(0, (nowMs - lastOfferMs) / 60_000) : 30;
  const rotation = clamp(idleMinutes / 6, 0, 12);

  const received = Math.max(0, Number(stats?.offers_received ?? 0));
  const accepted = Math.max(0, Number(stats?.offers_accepted ?? 0));
  const recentReliability = received > 0 ? accepted / received : 0.7;
  const storedAcceptance = quality?.acceptance_rate == null
    ? recentReliability
    : clamp(Number(quality.acceptance_rate) / 100, 0, 1);
  const reliability = storedAcceptance * 11;

  const rating = quality?.avg_rating == null ? 4 : clamp(Number(quality.avg_rating), 1, 5);
  const qualityValue = quality?.quality_score == null ? 70 : clamp(Number(quality.quality_score), 0, 100);
  const qualityScore = (rating / 5) * 5 + (qualityValue / 100) * 4;

  const missed = Math.max(0, Number(stats?.offers_missed ?? 0));
  const missedPenalty = -clamp(received > 0 ? (missed / received) * 8 : 0, 0, 6);
  const total = round2(distance + rotation + reliability + qualityScore + missedPenalty);

  const breakdown: DispatchScoreBreakdown = {
    distance: round2(distance),
    rotation: round2(rotation),
    reliability: round2(reliability),
    quality: round2(qualityScore),
    missedPenalty: round2(missedPenalty),
    total,
  };

  return breakdown;
}

export async function getDispatchCandidates(params: {
  supabase: SupabaseClient;
  tripId: string;
  pickupLat: number;
  pickupLng: number;
  rideOption?: string | null;
  radiusKm: number;
  excludedDriverIds?: string[];
}) {
  const { supabase, tripId, pickupLat, pickupLng, rideOption, radiusKm } = params;
  const excluded = new Set(params.excludedDriverIds ?? []);
  const now = Date.now();
  const offerEligibleAfter = new Date(
    now - DISPATCH_CONFIG.backgroundOfferEligibilitySeconds * 1000,
  ).toISOString();

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("id,status,verification_status,profile_completed,online,busy,lat,lng,last_seen,subscription_status,subscription_expires_at,seating_capacity,is_deleted")
    .eq("online", true)
    .gte("last_seen", offerEligibleAfter)
    .limit(250);

  if (driversError) throw new Error(driversError.message);

  const prelim = ((drivers ?? []) as CandidateRow[]).filter((driver) => {
    if (excluded.has(driver.id) || driver.is_deleted) return false;
    if (driver.profile_completed === false) return false;
    if (!["approved", "active"].includes(String(driver.status ?? ""))) return false;
    if (driver.verification_status && driver.verification_status !== "approved") return false;
    if (!["active", "grace"].includes(String(driver.subscription_status ?? ""))) return false;
    if (!driver.subscription_expires_at || new Date(driver.subscription_expires_at).getTime() <= now) return false;
    if (driver.lat == null || driver.lng == null) return false;
    if (!compatibleCapacity(rideOption, driver.seating_capacity)) return false;
    return haversineKm(pickupLat, pickupLng, Number(driver.lat), Number(driver.lng)) <= radiusKm;
  });

  if (prelim.length === 0) return [] as DispatchCandidate[];
  const driverIds = prelim.map((driver) => driver.id);

  const [walletsResult, qualityResult, statsResult, activeTripsResult, declinedResult, activeOfferResult] = await Promise.all([
    supabase.from("driver_wallets").select("driver_id,balance_due").in("driver_id", driverIds),
    supabase.from("driver_quality_metrics").select("driver_id,avg_rating,quality_score,acceptance_rate").in("driver_id", driverIds),
    supabase.from("driver_offer_stats").select("driver_id,offers_received,offers_accepted,offers_rejected,offers_missed,last_offer_at").in("driver_id", driverIds),
    supabase.from("trips").select("driver_id").in("driver_id", driverIds).in("status", ["assigned", "arrived", "ongoing"]),
    supabase.from("driver_trip_offers").select("driver_id").eq("trip_id", tripId).in("driver_id", driverIds).eq("status", "declined"),
    supabase.from("driver_trip_offers").select("driver_id").eq("trip_id", tripId).in("driver_id", driverIds).in("status", ["pending", "shown"]),
  ]);

  const fatal = [walletsResult.error, activeTripsResult.error, activeOfferResult.error].find(Boolean);
  if (fatal) throw new Error(fatal.message);

  const wallets = new Map(((walletsResult.data ?? []) as WalletRow[]).map((row) => [row.driver_id, row]));
  const qualities = new Map(((qualityResult.data ?? []) as QualityRow[]).map((row) => [row.driver_id, row]));
  const stats = new Map(((statsResult.data ?? []) as OfferStatsRow[]).map((row) => [row.driver_id, row]));
  const activeDriverIds = new Set((activeTripsResult.data ?? []).map((row) => row.driver_id).filter(Boolean));
  const declinedDriverIds = new Set((declinedResult.data ?? []).map((row) => row.driver_id).filter(Boolean));
  const activeOfferDriverIds = new Set((activeOfferResult.data ?? []).map((row) => row.driver_id).filter(Boolean));

  return prelim
    .filter((driver) => !activeDriverIds.has(driver.id))
    .filter((driver) => !declinedDriverIds.has(driver.id))
    .filter((driver) => !activeOfferDriverIds.has(driver.id))
    .filter((driver) => Number(wallets.get(driver.id)?.balance_due ?? 0) < DRIVER_COMMISSION_LOCK_LIMIT)
    .map((driver): DispatchCandidate => {
      const distanceKm = round2(haversineKm(pickupLat, pickupLng, Number(driver.lat), Number(driver.lng)));
      const scoreBreakdown = scoreCandidate({
        distanceKm,
        quality: qualities.get(driver.id),
        stats: stats.get(driver.id),
        nowMs: now,
      });
      return {
        driverId: driver.id,
        distanceKm,
        roadEtaSeconds: Math.max(60, Math.round((distanceKm / 35) * 3600)),
        score: scoreBreakdown.total,
        scoreBreakdown,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, DISPATCH_CONFIG.maxCandidatesPerStep);
}

export async function getPreferredDispatchCandidate(params: {
  supabase: SupabaseClient;
  tripId: string;
  driverId: string;
  pickupLat: number;
  pickupLng: number;
  rideOption?: string | null;
}) {
  const { supabase, tripId, driverId, pickupLat, pickupLng, rideOption } = params;
  const now = Date.now();
  const offerEligibleAfter = new Date(
    now - DISPATCH_CONFIG.backgroundOfferEligibilitySeconds * 1000,
  ).toISOString();

  const { data: driver, error: driverError } = await supabase
    .from("drivers")
    .select("id,status,verification_status,profile_completed,online,busy,lat,lng,last_seen,subscription_status,subscription_expires_at,seating_capacity,is_deleted")
    .eq("id", driverId)
    .maybeSingle();

  if (driverError) throw new Error(driverError.message);
  if (!driver) return { ok: false as const, error: "Driver not found." };

  const row = driver as CandidateRow;
  if (row.is_deleted) return { ok: false as const, error: "Driver is deleted." };
  if (!row.online) return { ok: false as const, error: "Driver is offline." };
  if (!row.last_seen || row.last_seen < offerEligibleAfter) {
    return { ok: false as const, error: "Driver online session is stale. Ask the driver to open the app and go online again." };
  }
  if (row.profile_completed === false) return { ok: false as const, error: "Driver profile is incomplete." };
  if (!["approved", "active"].includes(String(row.status ?? ""))) return { ok: false as const, error: "Driver is not approved or active." };
  if (row.verification_status && row.verification_status !== "approved") return { ok: false as const, error: "Driver verification is not approved." };
  if (!["active", "grace"].includes(String(row.subscription_status ?? ""))) return { ok: false as const, error: "Driver subscription is not active." };
  if (!row.subscription_expires_at || new Date(row.subscription_expires_at).getTime() <= now) return { ok: false as const, error: "Driver subscription has expired." };
  if (row.lat == null || row.lng == null) return { ok: false as const, error: "Driver GPS location is missing." };
  if (!compatibleCapacity(rideOption, row.seating_capacity)) return { ok: false as const, error: "Driver vehicle does not match this ride type." };

  const [walletResult, activeTripsResult, declinedResult, activeOfferResult, qualityResult, statsResult] = await Promise.all([
    supabase.from("driver_wallets").select("driver_id,balance_due").eq("driver_id", driverId).maybeSingle(),
    supabase.from("trips").select("driver_id").eq("driver_id", driverId).in("status", ["assigned", "arrived", "ongoing"]).limit(1),
    supabase.from("driver_trip_offers").select("driver_id").eq("trip_id", tripId).eq("driver_id", driverId).eq("status", "declined").limit(1),
    supabase.from("driver_trip_offers").select("driver_id").eq("trip_id", tripId).eq("driver_id", driverId).in("status", ["pending", "shown"]).limit(1),
    supabase.from("driver_quality_metrics").select("driver_id,avg_rating,quality_score,acceptance_rate").eq("driver_id", driverId).maybeSingle(),
    supabase.from("driver_offer_stats").select("driver_id,offers_received,offers_accepted,offers_rejected,offers_missed,last_offer_at").eq("driver_id", driverId).maybeSingle(),
  ]);

  const fatal = [walletResult.error, activeTripsResult.error, declinedResult.error, activeOfferResult.error].find(Boolean);
  if (fatal) throw new Error(fatal.message);
  if (Number((walletResult.data as WalletRow | null)?.balance_due ?? 0) >= DRIVER_COMMISSION_LOCK_LIMIT) return { ok: false as const, error: "Driver commission balance is locked." };
  if ((activeTripsResult.data ?? []).length > 0) return { ok: false as const, error: "Driver already has an active trip." };
  if ((declinedResult.data ?? []).length > 0) return { ok: false as const, error: "Driver already declined this trip." };
  if ((activeOfferResult.data ?? []).length > 0) return { ok: false as const, error: "Driver already has this offer." };

  const distanceKm = round2(haversineKm(pickupLat, pickupLng, Number(row.lat), Number(row.lng)));
  const scoreBreakdown = scoreCandidate({
    distanceKm,
    quality: (qualityResult.data as QualityRow | null) ?? undefined,
    stats: (statsResult.data as OfferStatsRow | null) ?? undefined,
    nowMs: now,
  });

  return {
    ok: true as const,
    candidate: {
      driverId,
      distanceKm,
      roadEtaSeconds: Math.max(60, Math.round((distanceKm / 35) * 3600)),
      score: scoreBreakdown.total,
      scoreBreakdown,
    } satisfies DispatchCandidate,
  };
}
