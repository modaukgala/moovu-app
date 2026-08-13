import type { SupabaseClient } from "@supabase/supabase-js";
import { haversineKm } from "@/lib/dispatch/driverScoring";

type LiveTripRow = {
  id: string;
  status: string;
  actual_distance_km: number | null;
  actual_duration_min: number | null;
  trip_started_at: string | null;
};

function isMissingTelemetrySchema(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42P01" || error?.code === "42703" || message.includes("trip_location_points") || message.includes("trip_started_at");
}

export async function recordTripTelemetry(params: {
  supabase: SupabaseClient;
  driverId: string;
  lat: number;
  lng: number;
  heading?: number | null;
  speedMps?: number | null;
  accuracyM?: number | null;
  capturedAt?: string;
}) {
  const capturedAt = params.capturedAt ?? new Date().toISOString();
  const { data: trip, error: tripError } = await params.supabase
    .from("trips")
    .select("id,status,actual_distance_km,actual_duration_min,trip_started_at")
    .eq("driver_id", params.driverId)
    .in("status", ["assigned", "arrived", "ongoing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (isMissingTelemetrySchema(tripError)) return { ok: true as const, skipped: true as const };
  if (tripError) return { ok: false as const, error: tripError.message };
  if (!trip) return { ok: true as const, skipped: true as const };
  const typedTrip = trip as LiveTripRow;

  const { data: previous, error: previousError } = await params.supabase
    .from("trip_location_points")
    .select("lat,lng,captured_at")
    .eq("trip_id", typedTrip.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousError && !isMissingTelemetrySchema(previousError)) return { ok: false as const, error: previousError.message };

  const previousAt = previous?.captured_at ? new Date(previous.captured_at).getTime() : null;
  const elapsedSeconds = previousAt ? Math.max(0, (new Date(capturedAt).getTime() - previousAt) / 1000) : 0;
  const segmentKm = previous
    ? haversineKm(Number(previous.lat), Number(previous.lng), params.lat, params.lng)
    : 0;
  const plausibleMaxKm = Math.max(0.05, elapsedSeconds * 0.07);
  const acceptedSegmentKm = segmentKm <= plausibleMaxKm ? segmentKm : 0;

  const { error: insertError } = await params.supabase.from("trip_location_points").insert({
    trip_id: typedTrip.id,
    driver_id: params.driverId,
    lat: params.lat,
    lng: params.lng,
    heading: params.heading ?? null,
    speed_mps: params.speedMps ?? null,
    accuracy_m: params.accuracyM ?? null,
    segment_distance_km: acceptedSegmentKm,
    captured_at: capturedAt,
  });
  if (insertError) {
    if (isMissingTelemetrySchema(insertError)) return { ok: true as const, skipped: true as const };
    return { ok: false as const, error: insertError.message };
  }

  await params.supabase.from("trip_live_locations").upsert({
    trip_id: typedTrip.id,
    driver_id: params.driverId,
    lat: params.lat,
    lng: params.lng,
    heading: params.heading ?? null,
    speed_mps: params.speedMps ?? null,
    accuracy_m: params.accuracyM ?? null,
    captured_at: capturedAt,
    updated_at: capturedAt,
  }, { onConflict: "trip_id" });

  if (typedTrip.status !== "ongoing" || !typedTrip.trip_started_at) {
    return { ok: true as const, tripId: typedTrip.id, fareUpdated: false };
  }

  const currentDistance = Math.max(0, Number(typedTrip.actual_distance_km ?? 0) + acceptedSegmentKm);
  const durationMin = Math.max(0, (new Date(capturedAt).getTime() - new Date(typedTrip.trip_started_at).getTime()) / 60_000);
  const update: Record<string, unknown> = {
    actual_distance_km: Math.round(currentDistance * 1000) / 1000,
    actual_duration_min: Math.round(durationMin * 100) / 100,
    actual_route_source: "gps_audit",
  };

  const { error: updateError } = await params.supabase.from("trips").update(update).eq("id", typedTrip.id).eq("status", "ongoing");
  return updateError ? { ok: false as const, error: updateError.message } : { ok: true as const, tripId: typedTrip.id, fareUpdated: false as const };
}
