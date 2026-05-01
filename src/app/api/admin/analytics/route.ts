import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { releaseDueScheduledTrips } from "@/lib/operations/releaseDueScheduledTrips";

type DriverDirectoryRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
};

type DriverQualityRow = {
  driver_id: string;
  avg_rating?: number | null;
  total_ratings?: number | null;
  total_issues?: number | null;
  total_completed_trips?: number | null;
  quality_score?: number | null;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

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
      drivers,
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
        .select("id,cancelled_by,cancellation_fee_amount,created_at,rider_name")
        .eq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("driver_quality_metrics")
        .select("driver_id,avg_rating,total_ratings,total_completed_trips,quality_score")
        .order("quality_score", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("drivers")
        .select("id,first_name,last_name,phone"),
    ]);

    const driverNameById = new Map<string, string>();
    for (const d of (drivers.data ?? []) as DriverDirectoryRow[]) {
      const fullName = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim();
      driverNameById.set(d.id, fullName || d.phone || d.id);
    }

    return NextResponse.json({
      ok: true,
      analytics: {
        scheduled_due_next_hour: scheduledDue.count ?? 0,
        scheduled_total_pending: scheduledTotal.count ?? 0,
        open_support_issues: openIssues.count ?? 0,
        low_rated_drivers: ((lowRatedDrivers.data ?? []) as DriverQualityRow[]).map((row) => ({
          ...row,
          driver_name: driverNameById.get(row.driver_id) ?? row.driver_id,
        })),
        recent_cancellations: cancellations.data ?? [],
        top_drivers: ((topDrivers.data ?? []) as DriverQualityRow[]).map((row) => ({
          ...row,
          driver_name: driverNameById.get(row.driver_id) ?? row.driver_id,
        })),
        generated_at: now,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Failed to load analytics.") },
      { status: 500 }
    );
  }
}
