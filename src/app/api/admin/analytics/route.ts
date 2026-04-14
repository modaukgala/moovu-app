import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { releaseDueScheduledTrips } from "@/lib/operations/releaseDueScheduledTrips";

export async function GET(req: Request) {
  try {
    await releaseDueScheduledTrips().catch(() => {});

    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { supabaseAdmin } = auth;

    const now = new Date().toISOString();
    const nextHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const [
      scheduledDue,
      scheduledTotal,
      openIssues,
      lowRatedDrivers,
      cancellations,
      topDrivers,
    ] = await Promise.all([
      supabaseAdmin
        .from("trips")
        .select("id", { count: "exact", head: true })
        .eq("ride_type", "scheduled")
        .eq("status", "scheduled")
        .lte("scheduled_for", nextHour),
      supabaseAdmin
        .from("trips")
        .select("id", { count: "exact", head: true })
        .eq("ride_type", "scheduled")
        .eq("status", "scheduled"),
      supabaseAdmin
        .from("trip_issues")
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
      supabaseAdmin
        .from("driver_quality_metrics")
        .select("driver_id,avg_rating,total_ratings,total_issues,quality_score")
        .lte("avg_rating", 3.8)
        .order("avg_rating", { ascending: true })
        .limit(10),
      supabaseAdmin
        .from("trips")
        .select("id,cancelled_by,cancellation_fee_amount,created_at")
        .eq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("driver_quality_metrics")
        .select("driver_id,avg_rating,total_ratings,total_completed_trips,quality_score")
        .order("quality_score", { ascending: false })
        .limit(10),
    ]);

    return NextResponse.json({
      ok: true,
      analytics: {
        scheduled_due_next_hour: scheduledDue.count ?? 0,
        scheduled_total_pending: scheduledTotal.count ?? 0,
        open_support_issues: openIssues.count ?? 0,
        low_rated_drivers: lowRatedDrivers.data ?? [],
        recent_cancellations: cancellations.data ?? [],
        top_drivers: topDrivers.data ?? [],
        generated_at: now,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load analytics." },
      { status: 500 }
    );
  }
}