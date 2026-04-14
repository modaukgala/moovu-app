import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export async function rebuildDriverQualityMetrics(driverId: string) {
  const { data: ratings } = await supabaseAdmin
    .from("trip_ratings")
    .select("rating")
    .eq("driver_id", driverId);

  const { data: issues } = await supabaseAdmin
    .from("trip_issues")
    .select("id")
    .eq("driver_id", driverId);

  const { data: completedTrips } = await supabaseAdmin
    .from("trips")
    .select("id")
    .eq("driver_id", driverId)
    .eq("status", "completed");

  const { data: allAssignedTrips } = await supabaseAdmin
    .from("trips")
    .select("id,status")
    .eq("driver_id", driverId)
    .in("status", ["completed", "cancelled", "ongoing", "arrived", "assigned"]);

  const { data: offerStats } = await supabaseAdmin
    .from("driver_offer_stats")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  const totalRatings = ratings?.length ?? 0;
  const avgRating =
    totalRatings > 0
      ? round2(
          ratings!.reduce((sum, row) => sum + Number(row.rating || 0), 0) / totalRatings
        )
      : 5;

  const totalIssues = issues?.length ?? 0;
  const totalCompletedTrips = completedTrips?.length ?? 0;
  const totalAssigned = allAssignedTrips?.length ?? 0;

  const completionRate =
    totalAssigned > 0 ? round2((totalCompletedTrips / totalAssigned) * 100) : 100;

  const acceptanceRate =
    offerStats && Number(offerStats.offers_received || 0) > 0
      ? round2(
          (Number(offerStats.offers_accepted || 0) /
            Number(offerStats.offers_received || 0)) *
            100
        )
      : 100;

  const qualityScore = round2(
    avgRating * 12 +
      completionRate * 0.35 +
      acceptanceRate * 0.25 -
      totalIssues * 4
  );

  const { error } = await supabaseAdmin
    .from("driver_quality_metrics")
    .upsert(
      {
        driver_id: driverId,
        avg_rating: avgRating,
        total_ratings: totalRatings,
        total_issues: totalIssues,
        total_completed_trips: totalCompletedTrips,
        completion_rate: completionRate,
        acceptance_rate: acceptanceRate,
        quality_score: qualityScore,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "driver_id" }
    );

  if (error) {
    throw new Error(error.message);
  }

  return {
    driverId,
    avgRating,
    totalRatings,
    totalIssues,
    totalCompletedTrips,
    completionRate,
    acceptanceRate,
    qualityScore,
  };
}