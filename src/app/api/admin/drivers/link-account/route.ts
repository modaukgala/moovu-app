import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { requireAdminUser } from "@/lib/auth/admin";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";

async function getUserIdByEmail(client: SupabaseClient, email: string) {
  const { data, error } = await client.auth.admin.listUsers({ perPage: 1000, page: 1 });
  if (error) return null;
  return (data?.users ?? []).find((user: User) => (user.email ?? "").toLowerCase() === email)?.id ?? null;
}
type Result = { user_id: string; driver_id: string | null; action: string; replayed: boolean };
export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const action = String(body?.action ?? "link");
    if (!email || !["link", "unlink"].includes(action)) return NextResponse.json({ ok: false, error: "Invalid email or action." }, { status: 400 });
    const userId = await getUserIdByEmail(auth.supabaseAdmin, email);
    if (!userId) return NextResponse.json({ ok: false, error: "No auth user found for that email" }, { status: 404 });
    const driverId = body?.driverId ? String(body.driverId).trim() : null;
    if (action === "link" && !driverId) return NextResponse.json({ ok: false, error: "Missing driverId" }, { status: 400 });
    const result = await callHardenedRpc<Result>(auth.supabaseAdmin, "phase05b_manage_driver_link", {
      p_application_id: null, p_user_id: userId, p_driver_id: driverId, p_action: action, p_actor_id: auth.user.id,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ ok: true, replayed: result.result.replayed, message: `${action === "link" ? "Linked" : "Unlinked"} successfully`, userId, driverId });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
