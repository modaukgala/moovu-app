import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushSafe } from "@/lib/push-server";
import {
  CUSTOMER_PROMO_MIN_DRIVERS, dueOnboardingReminder, needsOnboardingReminder,
  onboardingReminderCopy, weekKey, withinFriendlyHours,
} from "@/lib/engagement/engagementRules";

const MAX_DRIVER_REMINDERS_PER_RUN = 30;
const MAX_CUSTOMER_PUSHES_PER_RUN = 100;

async function sentEventKeys(prefix: string) {
  const { data } = await supabaseAdmin.from("app_notifications")
    .select("event_key,created_at").like("event_key", `${prefix}%`).limit(5000);
  return data ?? [];
}

/** Hourly cron: onboarding reminders for drivers, weekly "drivers online" nudge for idle customers. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!withinFriendlyHours()) return NextResponse.json({ ok: true, skipped: "outside 08:00-19:00 SAST" });

  // 1. Driver onboarding reminders (old-system drivers, drafts, corrections).
  const { data: accounts } = await supabaseAdmin.from("driver_accounts").select("user_id,driver_id");
  const { data: drivers } = await supabaseAdmin.from("drivers").select("id,is_deleted,status");
  const { data: apps } = await supabaseAdmin.from("phase6_applications").select("driver_id,status,cycle");
  const latest = new Map<string, { status: string; cycle: number }>();
  for (const a of apps ?? []) {
    const cur = latest.get(a.driver_id);
    if (!cur || a.cycle > cur.cycle) latest.set(a.driver_id, a);
  }
  const live = new Map((drivers ?? []).filter((d) => !d.is_deleted && d.status !== "inactive").map((d) => [d.id, d]));
  const sent = await sentEventKeys("onboarding-reminder:");
  const sentByDriver = new Map<string, number[]>();
  for (const s of sent) {
    const id = String(s.event_key).split(":")[1];
    sentByDriver.set(id, [...(sentByDriver.get(id) ?? []), Date.parse(s.created_at)]);
  }
  let driverReminders = 0;
  for (const acc of accounts ?? []) {
    if (driverReminders >= MAX_DRIVER_REMINDERS_PER_RUN) break;
    if (!live.has(acc.driver_id)) continue;
    const status = latest.get(acc.driver_id)?.status ?? null;
    if (!needsOnboardingReminder(status)) continue;
    const n = dueOnboardingReminder(sentByDriver.get(acc.driver_id) ?? []);
    if (!n) continue;
    const copy = onboardingReminderCopy(status);
    await sendPushSafe({
      userIds: [acc.user_id], role: "driver", title: copy.title, body: copy.body, url: "/driver/onboarding",
      data: { type: "onboarding_reminder" }, notificationEventKey: `onboarding-reminder:${acc.driver_id}:${n}`,
    });
    driverReminders += 1;
  }

  // 2. "Drivers are online" nudge for customers who never booked (max once a week each).
  const fresh = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count: onlineDrivers } = await supabaseAdmin.from("drivers").select("id", { count: "exact", head: true })
    .eq("online", true).eq("busy", false).gte("last_seen", fresh);
  let customerPushes = 0;
  if ((onlineDrivers ?? 0) >= CUSTOMER_PROMO_MIN_DRIVERS) {
    const week = weekKey();
    const { data: tokenRows } = await supabaseAdmin.from("fcm_tokens").select("user_id")
      .eq("role", "customer").eq("is_active", true).limit(5000);
    const withTokens = new Set((tokenRows ?? []).map((t) => String(t.user_id)));
    const { data: customers } = await supabaseAdmin.from("customers").select("id,auth_user_id").limit(5000);
    const { data: booked } = await supabaseAdmin.from("trips").select("customer_id").limit(20000);
    const bookedIds = new Set((booked ?? []).map((t) => String(t.customer_id)));
    const already = new Set((await sentEventKeys(`drivers-online:${week}:`)).map((s) => String(s.event_key)));
    for (const c of customers ?? []) {
      if (customerPushes >= MAX_CUSTOMER_PUSHES_PER_RUN) break;
      if (!c.auth_user_id || bookedIds.has(c.id) || !withTokens.has(c.auth_user_id)) continue;
      const key = `drivers-online:${week}:${c.id}`;
      if (already.has(key)) continue;
      await sendPushSafe({
        userIds: [c.auth_user_id], role: "customer",
        title: "MOOVU drivers are online now",
        body: "Need a ride? Book in seconds and see your fare before you confirm.",
        url: "/book", data: { type: "drivers_online" }, notificationEventKey: key,
      });
      customerPushes += 1;
    }
  }

  return NextResponse.json({ ok: true, driverReminders, onlineDrivers, customerPushes });
}
