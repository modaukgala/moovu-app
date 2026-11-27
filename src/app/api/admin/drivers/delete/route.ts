import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { executeDriverDeletion } from "@/lib/account-deletion/service";

/** Admin deletes a driver account (e.g. the driver asked and couldn't do it themselves). Body: { driverId, reason, confirm: "DELETE" } */
export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Only the owner or an admin can delete drivers." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const driverId = String(body?.driverId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(driverId)) return NextResponse.json({ ok: false, error: "Invalid driver." }, { status: 400 });
  if (body?.confirm !== "DELETE") return NextResponse.json({ ok: false, error: "Type DELETE to confirm." }, { status: 400 });
  if (driverId === "6fe679ab-8065-48cc-84b0-5ddd56e300b6") return NextResponse.json({ ok: false, error: "This is the owner's driver account and can't be deleted here." }, { status: 403 });
  const result = await executeDriverDeletion({
    supabase: auth.supabaseAdmin, actorId: auth.user.id, driverId,
    reason: String(body?.reason ?? "").trim() || "Removed by admin", byDriver: false,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
