import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const IN_PROGRESS_STATUSES = ["requested", "offered", "assigned", "arrived", "started"];

function safeNumber(x: any) {
  return typeof x === "number" && isFinite(x) ? x : 0;
}

function normPlan(plan: any): "daily" | "weekly" | "monthly" | null {
  const p = String(plan ?? "").trim().toLowerCase();
  if (p === "daily") return "daily";
  if (p === "weekly") return "weekly";
  if (p === "monthly") return "monthly";
  return null;
}

function calcAmountDue(plan: "daily" | "weekly" | "monthly" | null, daysOverdue: number): number {
  if (daysOverdue <= 0) return 0;

  if (plan === "daily") return daysOverdue * 45;
  if (plan === "weekly") return Math.ceil(daysOverdue / 7) * 90;
  if (plan === "monthly") return Math.ceil(daysOverdue / 30) * 200;

  // If plan not set, default to monthly (safest)
  return Math.ceil(daysOverdue / 30) * 200;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const fromIso = from
      ? new Date(from).toISOString()
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const toIso = to ? new Date(to).toISOString() : new Date().toISOString();

    // 1) Drivers
    const { data: drivers, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select(
        "id,first_name,last_name,phone,status,online,busy,subscription_status,subscription_expires_at,subscription_plan,created_at"
      )
      .order("created_at", { ascending: false })
      .limit(800);

    if (dErr) return NextResponse.json({ ok: false, error: dErr.message }, { status: 500 });

    // 2) Completed trips in range
    const { data: completedTrips, error: cErr } = await supabaseAdmin
      .from("trips")
      .select("id,driver_id,fare_amount,payment_method,status,created_at")
      .eq("status", "completed")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .limit(10000);

    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });

    // 3) In-progress trips in range
    const { data: progressTrips, error: pErr } = await supabaseAdmin
      .from("trips")
      .select("id,driver_id,fare_amount,payment_method,status,created_at,offer_status,offer_expires_at")
      .in("status", IN_PROGRESS_STATUSES)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .limit(10000);

    if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });

    // Aggregate completed
    const completedMap = new Map<string, { trips: number; total: number; cashTrips: number; cashTotal: number }>();

    for (const tr of completedTrips ?? []) {
      if (!tr.driver_id) continue;
      const fare = safeNumber(tr.fare_amount);
      const isCash = String(tr.payment_method ?? "").toLowerCase() === "cash";

      const curr = completedMap.get(tr.driver_id) ?? { trips: 0, total: 0, cashTrips: 0, cashTotal: 0 };
      curr.trips += 1;
      curr.total += fare;
      if (isCash) {
        curr.cashTrips += 1;
        curr.cashTotal += fare;
      }
      completedMap.set(tr.driver_id, curr);
    }

    // Aggregate in-progress
    const progressMap = new Map<string, { inProgress: number; inProgressTotal: number; byStatus: Record<string, number> }>();

    for (const tr of progressTrips ?? []) {
      if (!tr.driver_id) continue;
      const fare = safeNumber(tr.fare_amount);

      const curr = progressMap.get(tr.driver_id) ?? { inProgress: 0, inProgressTotal: 0, byStatus: {} };
      curr.inProgress += 1;
      curr.inProgressTotal += fare;

      const st = String(tr.status ?? "unknown");
      curr.byStatus[st] = (curr.byStatus[st] ?? 0) + 1;

      progressMap.set(tr.driver_id, curr);
    }

    const now = Date.now();

    const rows = (drivers ?? []).map((d: any) => {
      const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";

      const comp = completedMap.get(d.id) ?? { trips: 0, total: 0, cashTrips: 0, cashTotal: 0 };
      const avg = comp.trips > 0 ? comp.total / comp.trips : 0;

      const prog = progressMap.get(d.id) ?? { inProgress: 0, inProgressTotal: 0, byStatus: {} };

      const expMs = d.subscription_expires_at ? new Date(d.subscription_expires_at).getTime() : null;
      const subStatus = String(d.subscription_status ?? "inactive");
      const plan = normPlan(d.subscription_plan);

      const isExpired = expMs != null ? expMs < now : true; // if no expiry, treat as expired
      const due = isExpired || !(subStatus === "active" || subStatus === "grace");

      const daysOverdue =
        expMs != null && expMs < now ? Math.ceil((now - expMs) / (24 * 60 * 60 * 1000)) : due ? 1 : 0;

      const amountDue = due ? calcAmountDue(plan, daysOverdue) : 0;

      return {
        driver_id: d.id,
        name,
        phone: d.phone ?? null,
        status: d.status ?? null,
        online: !!d.online,
        busy: !!d.busy,

        subscription_status: d.subscription_status ?? null,
        subscription_plan: plan ?? (d.subscription_plan ?? null),
        subscription_expires_at: d.subscription_expires_at ?? null,

        subscription_due: due,
        subscription_days_overdue: daysOverdue,
        subscription_amount_due: amountDue,

        trips_completed: comp.trips,
        total_earnings: Math.round(comp.total * 100) / 100,
        cash_trips: comp.cashTrips,
        cash_total: Math.round(comp.cashTotal * 100) / 100,
        avg_fare: Math.round(avg * 100) / 100,

        in_progress_trips: prog.inProgress,
        in_progress_total: Math.round(prog.inProgressTotal * 100) / 100,
        in_progress_by_status: prog.byStatus,
      };
    });

    rows.sort(
      (a, b) =>
        (b.total_earnings ?? 0) - (a.total_earnings ?? 0) ||
        (b.in_progress_trips ?? 0) - (a.in_progress_trips ?? 0)
    );

    const totalTripsCompleted = (completedTrips ?? []).length;
    const totalEarningsAll =
      Math.round((completedTrips ?? []).reduce((s: number, t: any) => s + safeNumber(t.fare_amount), 0) * 100) / 100;

    const totalInProgress = (progressTrips ?? []).length;
    const totalInProgressAmount =
      Math.round((progressTrips ?? []).reduce((s: number, t: any) => s + safeNumber(t.fare_amount), 0) * 100) / 100;

    const totalSubDue = rows.reduce((s, r) => s + (r.subscription_amount_due ?? 0), 0);

    return NextResponse.json({
      ok: true,
      from: fromIso,
      to: toIso,
      rows,
      totals: {
        trips_completed: totalTripsCompleted,
        total_earnings: totalEarningsAll,
        in_progress_trips: totalInProgress,
        in_progress_total: totalInProgressAmount,
        subscription_due_total: Math.round(totalSubDue * 100) / 100,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}