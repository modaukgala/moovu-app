import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { PHASE6_NEEDS_REVIEW } from "@/lib/admin/applicationSummary";

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
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { supabaseAdmin } = auth;

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const southAfricaNow = new Date(nowDate.getTime() + 2 * 60 * 60 * 1000);
    const dayStart = new Date(Date.UTC(southAfricaNow.getUTCFullYear(), southAfricaNow.getUTCMonth(), southAfricaNow.getUTCDate()) - 2 * 60 * 60 * 1000);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const weekStart = new Date(dayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(Date.UTC(southAfricaNow.getUTCFullYear(), southAfricaNow.getUTCMonth(), 1) - 2 * 60 * 60 * 1000);
    const nextHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const expiringSoon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    const [
      completedToday,
      cancelledToday,
      bookingsToday,
      activeTrips,
      unassignedTrips,
      weeklyCompleted,
      monthlyCompleted,
      activeDrivers,
      onlineDrivers,
      pendingApplications,
      activeSubscriptions,
      expiringSubscriptions,
      scheduledDue,
      scheduledOverdue,
      scheduledTotal,
      openIssues,
      lowRatedDrivers,
      cancellations,
      topDrivers,
      drivers,
    ] = await Promise.all([
      supabaseAdmin
        .from("trips")
        .select("id,fare_amount,commission_amount", { count: "exact" })
        .eq("status", "completed")
        .gte("completed_at", dayStart.toISOString()).lt("completed_at", dayEnd.toISOString()),
      supabaseAdmin
        .from("trips")
        .select("id", { count: "exact", head: true })
        .eq("status", "cancelled")
        .gte("cancelled_at", dayStart.toISOString()).lt("cancelled_at", dayEnd.toISOString()),
      supabaseAdmin.from("trips").select("id", { count: "exact", head: true })
        .gte("created_at", dayStart.toISOString()).lt("created_at", dayEnd.toISOString()),
      supabaseAdmin.from("trips").select("id", { count: "exact", head: true })
        .in("status", ["requested", "offered", "assigned", "arrived", "ongoing"]),
      supabaseAdmin.from("trips").select("id", { count: "exact", head: true })
        .in("status", ["requested", "offered"]).is("driver_id", null),
      supabaseAdmin
        .from("trips")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("completed_at", weekStart.toISOString()),
      supabaseAdmin
        .from("trips")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("completed_at", monthStart.toISOString()),
      supabaseAdmin
        .from("drivers")
        .select("id", { count: "exact", head: true })
        .in("status", ["active", "approved"]),
      supabaseAdmin
        .from("drivers")
        .select("id", { count: "exact", head: true })
        .eq("online", true),
      supabaseAdmin
        .from("phase6_applications")
        .select("id", { count: "exact", head: true })
        .in("status", [...PHASE6_NEEDS_REVIEW]),
      supabaseAdmin
        .from("drivers")
        .select("id", { count: "exact", head: true })
        .eq("subscription_status", "active"),
      supabaseAdmin
        .from("drivers")
        .select("id", { count: "exact", head: true })
        .eq("subscription_status", "active")
        .gte("subscription_expires_at", now)
        .lte("subscription_expires_at", expiringSoon),
      supabaseAdmin
        .from("trips")
        .select("id", { count: "exact", head: true })
        .eq("ride_type", "scheduled")
        .eq("status", "scheduled")
        .gte("scheduled_for", now)
        .lte("scheduled_for", nextHour),
      supabaseAdmin.from("trips").select("id", { count: "exact", head: true })
        .eq("ride_type", "scheduled").eq("status", "scheduled").lt("scheduled_for", now),
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

    const completedTodayRows = (completedToday.data ?? []) as Array<{
      fare_amount?: number | string | null;
      commission_amount?: number | string | null;
    }>;
    const todayGrossRevenue = completedTodayRows.reduce(
      (sum, row) => sum + Number(row.fare_amount ?? 0),
      0
    );
    const todayCommissionOwed = completedTodayRows.reduce(
      (sum, row) => sum + Number(row.commission_amount ?? 0),
      0
    );
    const todayCompletedCount = completedToday.error ? null : completedToday.count ?? completedTodayRows.length;
    const todayCancelledCount = cancelledToday.error ? null : cancelledToday.count ?? 0;
    const todayTripTotal = todayCompletedCount == null || todayCancelledCount == null ? null : todayCompletedCount + todayCancelledCount;

    return NextResponse.json({
      ok: true,
      analytics: {
        operational_timezone: "Africa/Johannesburg",
        operational_day_start: dayStart.toISOString(),
        today_total_bookings: bookingsToday.error ? null : bookingsToday.count,
        today_completed_trips: todayCompletedCount,
        today_cancelled_trips: todayCancelledCount,
        active_trips: activeTrips.error ? null : activeTrips.count,
        unassigned_trips: unassignedTrips.error ? null : unassignedTrips.count,
        today_gross_revenue: completedToday.error || !isFinancialAdminRole(auth.profile.role) ? null : todayGrossRevenue,
        today_commission_owed: completedToday.error || !isFinancialAdminRole(auth.profile.role) ? null : todayCommissionOwed,
        weekly_trips: weeklyCompleted.error ? null : weeklyCompleted.count,
        monthly_trips: monthlyCompleted.error ? null : monthlyCompleted.count,
        active_drivers: activeDrivers.error ? null : activeDrivers.count,
        online_drivers: onlineDrivers.error ? null : onlineDrivers.count,
        pending_driver_applications: pendingApplications.error ? null : pendingApplications.count,
        active_subscriptions: activeSubscriptions.error ? null : activeSubscriptions.count,
        expiring_subscriptions: expiringSubscriptions.error ? null : expiringSubscriptions.count,
        average_fare: !isFinancialAdminRole(auth.profile.role) ? null : todayCompletedCount && todayCompletedCount > 0 ? todayGrossRevenue / todayCompletedCount : todayCompletedCount === 0 ? 0 : null,
        cancellation_rate: todayTripTotal && todayTripTotal > 0 && todayCancelledCount != null ? (todayCancelledCount / todayTripTotal) * 100 : todayTripTotal === 0 ? 0 : null,
        scheduled_due_next_hour: scheduledDue.error ? null : scheduledDue.count,
        scheduled_overdue: scheduledOverdue.error ? null : scheduledOverdue.count,
        scheduled_total_pending: scheduledTotal.error ? null : scheduledTotal.count,
        open_support_issues: openIssues.error ? null : openIssues.count,
        low_rated_drivers: ((lowRatedDrivers.data ?? []) as DriverQualityRow[]).map((row) => ({
          ...row,
          driver_name: driverNameById.get(row.driver_id) ?? "Driver profile unavailable",
        })),
        recent_cancellations: cancellations.data ?? [],
        top_drivers: ((topDrivers.data ?? []) as DriverQualityRow[]).map((row) => ({
          ...row,
          driver_name: driverNameById.get(row.driver_id) ?? "Driver profile unavailable",
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
