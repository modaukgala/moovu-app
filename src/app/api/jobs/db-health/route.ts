import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushSafe } from "@/lib/push-server";

type Health = { connections: number; active: number; waiting: number; max_connections: number };

// Idle Supabase service pools normally hold ~45-55 of 60, so warn only near the ceiling
// or when the database is actually busy or slow.
const NEAR_FULL_RATIO = 0.95;
const BUSY_ACTIVE = 15;
const SLOW_MS = 1500;

/** Every 15 min: warn admins (max once an hour) when the database is close to its limits. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const started = Date.now();
  let health: Health | null = null;
  let failed = false;
  try {
    const { data, error } = await supabaseAdmin.rpc("moovu_db_health");
    if (error) failed = true;
    else health = data as Health;
  } catch {
    failed = true;
  }
  const ms = Date.now() - started;

  const reasons: string[] = [];
  if (failed) reasons.push("the database did not answer");
  if (ms > SLOW_MS) reasons.push(`it took ${(ms / 1000).toFixed(1)}s to answer`);
  if (health && health.connections >= Math.floor(health.max_connections * NEAR_FULL_RATIO)) {
    reasons.push(`${health.connections} of ${health.max_connections} connections are in use`);
  }
  if (health && health.active >= BUSY_ACTIVE) reasons.push(`${health.active} requests are running at once`);
  if (health && health.waiting > 3) reasons.push(`${health.waiting} requests are waiting on locks`);

  if (reasons.length > 0) {
    const hour = new Date().toISOString().slice(0, 13);
    await sendPushSafe({
      role: "admin",
      title: "MOOVU database is under pressure",
      body: `Heads up: ${reasons.join(", ")}. If this keeps happening, upgrade Supabase.`,
      url: "/admin",
      data: { type: "db_health" },
      notificationEventKey: `db-health:${hour}`,
    }).catch(() => {});
    console.warn("[db-health] warning", { reasons, ms, health });
  }

  return NextResponse.json({ ok: true, ms, health, warned: reasons.length > 0 });
}
