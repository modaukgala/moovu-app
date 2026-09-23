import { phase6LegacyMutation } from "@/lib/drivers/phase6LegacyRoutes";
import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";

type Result = { driver_id: string; replayed: boolean };

export async function POST(req: Request) {
  const retirement = phase6LegacyMutation(req);
  if (retirement) return retirement;
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => null);
    const applicationId = String(body?.applicationId ?? "").trim();
    if (!applicationId) return NextResponse.json({ ok: false, error: "Missing applicationId" }, { status: 400 });
    const result = await callHardenedRpc<Result>(auth.supabaseAdmin, "phase05b_approve_driver_application", {
      p_application_id: applicationId, p_actor_id: auth.user.id,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ ok: true, replayed: result.result.replayed,
      message: result.result.replayed ? "Application was already linked." : "Driver created, linked and approved.", driverId: result.result.driver_id });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
