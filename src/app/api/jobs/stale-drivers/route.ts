import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushSafe } from "@/lib/push-server";
import { staleReminderDue } from "@/lib/dispatch/staleDriverPolicy";

/** Every 15 min: remind online drivers whose location stopped updating (at 30 min, then 2 h). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  const now = Date.now();
  const { data: drivers, error } = await supabaseAdmin.from("drivers")
    .select("id,last_seen").eq("online", true).eq("busy", false)
    .lt("last_seen", new Date(now - 30 * 60_000).toISOString())
    .gte("last_seen", new Date(now - 140 * 60_000).toISOString());
  if (error) return NextResponse.json({ ok: false, error: "Driver lookup failed." }, { status: 500 });

  const due = (drivers ?? []).map((d) => ({ id: d.id as string, at: staleReminderDue(d.last_seen, now) }))
    .filter((d) => d.at != null);
  if (due.length === 0) return NextResponse.json({ ok: true, reminded: 0 });

  const { data: accounts } = await supabaseAdmin.from("driver_accounts").select("driver_id,user_id")
    .in("driver_id", due.map((d) => d.id));
  const userByDriver = new Map((accounts ?? []).map((a) => [a.driver_id as string, a.user_id as string]));
  const first = due.filter((d) => d.at === 30).map((d) => userByDriver.get(d.id)).filter(Boolean) as string[];
  const last = due.filter((d) => d.at === 120).map((d) => userByDriver.get(d.id)).filter(Boolean) as string[];

  await Promise.allSettled([
    first.length && sendPushSafe({ userIds: first, role: "driver",
      title: "Still online for trips?",
      body: "We haven't had your location for 30 minutes. Open MOOVU so you keep receiving ride offers.",
      url: "/driver" }),
    last.length && sendPushSafe({ userIds: last, role: "driver",
      title: "You may be missing trips",
      body: "Your location hasn't updated in 2 hours. Open MOOVU to keep getting ride offers, or go offline.",
      url: "/driver" }),
  ]);
  console.info("[stale-drivers] reminders sent", { first: first.length, last: last.length });
  return NextResponse.json({ ok: true, reminded: first.length + last.length });
}
