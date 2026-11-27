import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";

/**
 * Correct a driver's first name and/or surname through the audited name-correction routine
 * (driver records are otherwise protected by the onboarding review). Body: { driverId, firstName, lastName, reason? }
 */
export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Only the owner or an admin can change driver names." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const driverId = String(body?.driverId ?? "");
  const wanted = { first_name: String(body?.firstName ?? "").trim().slice(0, 60), last_name: String(body?.lastName ?? "").trim().slice(0, 60) };
  if (!/^[0-9a-f-]{36}$/i.test(driverId)) return NextResponse.json({ ok: false, error: "Invalid driver." }, { status: 400 });
  if (!wanted.first_name || !wanted.last_name) return NextResponse.json({ ok: false, error: "First name and surname are required." }, { status: 400 });
  const reason = String(body?.reason ?? "").trim() || "Admin corrected the driver's name in the driver directory";
  const db = auth.supabaseAdmin;
  const { data: driver, error } = await db.from("drivers").select("first_name,last_name").eq("id", driverId).maybeSingle();
  if (error || !driver) return NextResponse.json({ ok: false, error: "Driver not found." }, { status: 404 });
  for (const field of ["first_name", "last_name"] as const) {
    if ((driver[field] ?? "") === wanted[field]) continue;
    const result = await db.rpc("phase5a_correct_driver_name", {
      p_actor: auth.user.id, p_driver: driverId, p_field: field, p_value: wanted[field],
      p_expected: driver[field], p_reason: reason.slice(0, 500), p_key: randomUUID(),
    });
    if (result.error) {
      console.error("[admin-driver-name] correction failed", { field, code: result.error.code, message: result.error.message });
      return NextResponse.json({ ok: false, error: "The name couldn't be saved. If the driver's application is under review, change it there." }, { status: 409 });
    }
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
