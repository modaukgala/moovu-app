import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { driverStage, missingItems, resolveDriverName, STAGE_LABEL } from "@/lib/admin/driverDirectory";
import type { Phase6Draft } from "@/lib/drivers/phase6Policy";

type Driver = {
  id: string; first_name: string | null; last_name: string | null; phone: string | null; email: string | null;
  status: string | null; verification_status: string | null; online: boolean | null; busy: boolean | null;
  last_seen: string | null; created_at: string | null; is_deleted: boolean | null;
  vehicle_make: string | null; vehicle_model: string | null; vehicle_registration: string | null;
  vehicle_color: string | null; vehicle_year: string | null; seating_capacity: number | null; delete_mode: string | null;
};

async function all<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

const norm = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();
const digits = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "").slice(-9);

/**
 * Every driver in one list, whichever system they came through, with their real name,
 * a single stage, what is missing from their application, and old applications with no driver yet.
 */
export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const db = auth.supabaseAdmin;
  try {
    const [drivers, applications, profiles, accounts, legacy, deletionAsks] = await Promise.all([
      all<Driver>((a, b) => db.from("drivers").select("id,first_name,last_name,phone,email,status,verification_status,online,busy,last_seen,created_at,is_deleted,vehicle_make,vehicle_model,vehicle_registration,vehicle_color,vehicle_year,seating_capacity,delete_mode").order("created_at", { ascending: false }).range(a, b)),
      all<{ driver_id: string; status: string; draft: Phase6Draft; cycle: number; updated_at: string }>((a, b) =>
        db.from("phase6_applications").select("driver_id,status,draft,cycle,updated_at").order("cycle", { ascending: false }).range(a, b)),
      all<{ driver_id: string; first_name: string | null; last_name: string | null; phone: string | null }>((a, b) =>
        db.from("driver_profiles").select("driver_id,first_name,last_name,phone").range(a, b)),
      all<{ driver_id: string; user_id: string }>((a, b) => db.from("driver_accounts").select("driver_id,user_id").range(a, b)),
      all<{ id: string; user_id: string | null; full_name: string | null; phone: string | null; email: string | null; status: string | null; created_at: string }>((a, b) =>
        db.from("driver_applications").select("id,user_id,full_name,phone,email,status,created_at").range(a, b)),
      all<{ driver_id: string; reason: string; created_at: string }>((a, b) =>
        db.from("phase6_retention_requests").select("driver_id,reason,created_at").in("status", ["REQUESTED", "HELD"]).range(a, b)),
    ]);
    const askByDriver = new Map(deletionAsks.map(r => [r.driver_id, r]));

    const appByDriver = new Map<string, (typeof applications)[number]>();
    for (const app of applications) if (!appByDriver.has(app.driver_id)) appByDriver.set(app.driver_id, app);
    const profileByDriver = new Map(profiles.map(p => [p.driver_id, p]));
    const userByDriver = new Map(accounts.map(a => [a.driver_id, a.user_id]));
    const driverByUser = new Map(accounts.map(a => [a.user_id, a.driver_id]));
    const driverByEmail = new Map(drivers.filter(d => d.email).map(d => [norm(d.email), d.id]));
    const driverByPhone = new Map(drivers.filter(d => digits(d.phone)).map(d => [digits(d.phone), d.id]));
    const legacyByDriver = new Map<string, (typeof legacy)[number]>();
    const unmatchedLegacy: typeof legacy = [];
    for (const app of legacy) {
      const id = (app.user_id && driverByUser.get(app.user_id)) || driverByEmail.get(norm(app.email)) || (digits(app.phone) && driverByPhone.get(digits(app.phone)));
      if (id) legacyByDriver.set(id, app); else unmatchedLegacy.push(app);
    }

    // Permanently deleted accounts are gone from the directory (their trips stay in the books).
    const rows = drivers.filter(d => !(d.is_deleted && d.delete_mode === "permanent")).map(d => {
      const app = appByDriver.get(d.id) ?? null;
      const profile = profileByDriver.get(d.id) ?? null;
      const oldApp = legacyByDriver.get(d.id) ?? null;
      const resolved = resolveDriverName({ ...d, draft: app?.draft ?? null, profile, legacyFullName: oldApp?.full_name });
      const stage = d.is_deleted ? "deactivated" : driverStage({ status: d.status, verification_status: d.verification_status, applicationStatus: app?.status ?? null, draft: app?.draft ?? null });
      const missing = stage === "draft" || stage === "not_started" || stage === "corrections" ? missingItems(app?.draft) : [];
      const draftPhone = String(app?.draft?.personal?.phone ?? "").trim();
      return {
        id: d.id,
        name: resolved.name,
        nameFromRecord: resolved.fromRecord,
        phone: d.phone || profile?.phone || draftPhone || oldApp?.phone || null,
        email: d.email,
        system: app ? "new" : "old",
        stage,
        stageLabel: STAGE_LABEL[stage],
        missing,
        linked: userByDriver.has(d.id),
        online: Boolean(d.online), busy: Boolean(d.busy), lastSeen: d.last_seen,
        vehicle: [d.vehicle_make, d.vehicle_model, d.vehicle_registration].filter(Boolean).join(" ") || null,
        joined: d.created_at,
        removed: Boolean(d.is_deleted),
        applicationUpdated: app?.updated_at ?? null,
        car: { make: d.vehicle_make, model: d.vehicle_model, color: d.vehicle_color, registration: d.vehicle_registration, year: d.vehicle_year, seats: d.seating_capacity },
        deletionRequest: !d.is_deleted && askByDriver.has(d.id) ? { reason: askByDriver.get(d.id)!.reason, at: askByDriver.get(d.id)!.created_at } : null,
      };
    });

    const only = new URL(req.url).searchParams.get("driverId");
    if (only) {
      const one = rows.find(r => r.id === only) ?? null;
      const app = appByDriver.get(only);
      return NextResponse.json({ ok: true, driver: one, applicationStatus: app?.status ?? null }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({
      ok: true,
      drivers: rows,
      oldApplications: unmatchedLegacy.map(a => ({ id: a.id, name: a.full_name, phone: a.phone, email: a.email, status: a.status, created_at: a.created_at })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[admin-driver-directory] failed", error);
    return NextResponse.json({ ok: false, error: "Drivers are unavailable right now." }, { status: 503 });
  }
}
