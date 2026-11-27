import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { sendPushSafe } from "@/lib/push-server";

type Target = { kind: "me" } | { kind: "customer" | "driver"; id: string };

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Resolve one person to their login id and push role. */
async function resolve(db: Awaited<ReturnType<typeof requireAdminUser>> & { ok: true }, target: Target) {
  if (target.kind === "me") return { userId: db.user.id, role: "admin" as const, name: "You (this admin login)" };
  if (target.kind === "customer") {
    const { data } = await db.supabaseAdmin.from("customers").select("auth_user_id,first_name,last_name").eq("id", target.id).maybeSingle();
    return data?.auth_user_id ? { userId: data.auth_user_id as string, role: "customer" as const, name: `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || "Customer" } : null;
  }
  const [{ data: account }, { data: driver }] = await Promise.all([
    db.supabaseAdmin.from("driver_accounts").select("user_id").eq("driver_id", target.id).maybeSingle(),
    db.supabaseAdmin.from("drivers").select("first_name,last_name").eq("id", target.id).maybeSingle(),
  ]);
  return account?.user_id ? { userId: account.user_id as string, role: "driver" as const, name: `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver" } : null;
}

/** Devices one person can receive notifications on. GET ?kind=customer|driver|me&id= */
async function devices(db: (Awaited<ReturnType<typeof requireAdminUser>> & { ok: true })["supabaseAdmin"], userId: string, role: string) {
  const { data } = await db.from("fcm_tokens").select("platform,app_type,updated_at,last_seen_at")
    .eq("user_id", userId).eq("role", role).eq("is_active", true).eq("enabled", true).order("updated_at", { ascending: false });
  return (data ?? []).map(d => ({ platform: d.platform, app: d.app_type, lastSeen: d.last_seen_at ?? d.updated_at }));
}

function parse(raw: unknown): Target | null {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (b.kind === "me") return { kind: "me" };
  if ((b.kind === "customer" || b.kind === "driver") && /^[0-9a-f-]{36}$/i.test(String(b.id ?? ""))) return { kind: b.kind, id: String(b.id) };
  return null;
}

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const params = new URL(req.url).searchParams;
  const target = parse({ kind: params.get("kind"), id: params.get("id") });
  if (!target) return NextResponse.json({ ok: false, error: "Choose a person." }, { status: 400 });
  const person = await resolve(auth, target);
  if (!person) return NextResponse.json({ ok: true, person: null, devices: [], problem: "This person has no app login linked, so they can't get notifications." }, { headers: NO_STORE });
  return NextResponse.json({ ok: true, person, devices: await devices(auth.supabaseAdmin, person.userId, person.role) }, { headers: NO_STORE });
}

/** Send ONE test notification to ONE person (never a whole group), and report what happened per device. */
export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const target = parse(await req.json().catch(() => null));
  if (!target) return NextResponse.json({ ok: false, error: "Choose a person." }, { status: 400 });
  const person = await resolve(auth, target);
  if (!person) return NextResponse.json({ ok: false, error: "This person has no app login linked, so they can't get notifications." }, { status: 404 });
  const list = await devices(auth.supabaseAdmin, person.userId, person.role);
  if (list.length === 0) {
    return NextResponse.json({ ok: true, delivered: 0, failed: 0, devices: [], explanation: "This person has no phone registered for notifications. Ask them to open the MOOVU app, sign in, and allow notifications when asked (or turn them on in their phone settings)." }, { headers: NO_STORE });
  }
  const result = await sendPushSafe({
    userIds: [person.userId],
    role: person.role,
    title: "MOOVU test notification",
    body: `Hi ${person.name.split(" ")[0]}, this is a test from MOOVU. You can ignore it.`,
    url: person.role === "driver" ? "/driver" : person.role === "admin" ? "/admin" : "/book",
    data: { type: "notification_test" },
    notificationEventKey: `notification-test:${person.userId}:${Date.now()}`,
  });
  const r = (result ?? {}) as { delivered?: number; failed?: number; removed?: number; failures?: { reason: string }[] };
  const delivered = Number(r.delivered ?? 0);
  const failed = Number(r.failed ?? 0);
  const explanation = delivered > 0
    ? `Sent to ${delivered} of ${list.length} device${list.length === 1 ? "" : "s"}. Ask ${person.name.split(" ")[0]} if it arrived. If not, notifications are probably switched off for MOOVU in their phone settings.`
    : `It didn't reach any device.${r.removed ? ` ${r.removed} old device registration${r.removed === 1 ? " was" : "s were"} expired and removed.` : ""} Ask them to open the app and sign in again so their phone registers again.`;
  return NextResponse.json({ ok: true, delivered, failed, removed: Number(r.removed ?? 0), reasons: (r.failures ?? []).map(f => f.reason).slice(0, 5), devices: list, explanation }, { headers: NO_STORE });
}
