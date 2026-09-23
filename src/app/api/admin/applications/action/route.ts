import { phase6LegacyMutation } from "@/lib/drivers/phase6LegacyRoutes";
import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";

type Result = { action: string; driver_id: string | null; replayed: boolean };
export async function POST(req: Request) {
  const retirement = phase6LegacyMutation(req);
  if (retirement) return retirement;
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => null);
    const action = String(body?.action ?? "").trim();
    const applicationId = String(body?.applicationId ?? "").trim();
    const userId = String(body?.userId ?? "").trim();
    if (!applicationId || !userId || !["approve", "reject", "link", "unlink"].includes(action)) return NextResponse.json({ ok: false, error: "Invalid action/application/user." }, { status: 400 });
    const result = await callHardenedRpc<Result>(auth.supabaseAdmin, "phase05b_manage_driver_link", {
      p_application_id: applicationId, p_user_id: userId, p_driver_id: body?.driverId ? String(body.driverId) : null,
      p_action: action, p_actor_id: auth.user.id,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ ok: true, replayed: result.result.replayed, message: `Application action ${action} completed.` });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
