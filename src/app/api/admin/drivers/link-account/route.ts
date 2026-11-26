import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { requireAdminUser } from "@/lib/auth/admin";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";

async function getUserIdByEmail(client: SupabaseClient, email: string) {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ perPage: 1000, page });
    if (error) return { ok: false as const, error };
    const match = (data?.users ?? []).find(
      (user: User) => (user.email ?? "").trim().toLowerCase() === email,
    );
    if (match) return { ok: true as const, userId: match.id };
    if ((data?.users ?? []).length < 1000) break;
  }
  return { ok: true as const, userId: null };
}
type Result = { user_id: string; driver_id: string | null; action: string; replayed: boolean };
export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const driverId = String(url.searchParams.get("driverId") ?? "").trim();
  const email = String(url.searchParams.get("email") ?? "").trim().toLowerCase();
  let targetLogin: { userId: string; email: string } | null = null;
  if (email) {
    const lookup = await getUserIdByEmail(auth.supabaseAdmin, email);
    if (!lookup.ok) return NextResponse.json({ ok: false, error: "Auth user lookup is unavailable.", code: "AUTH_LOOKUP_FAILED" }, { status: 503 });
    if (lookup.userId) targetLogin = { userId: lookup.userId, email };
  }
  let existingLink: { userId: string; email: string | null; driverId: string } | null = null;
  if (driverId) {
    const mapping = await auth.supabaseAdmin.from("driver_accounts").select("user_id,driver_id").eq("driver_id", driverId).maybeSingle();
    if (mapping.error) return NextResponse.json({ ok: false, error: "Existing driver linkage is unavailable." }, { status: 503 });
    if (mapping.data?.user_id) {
      const user = await auth.supabaseAdmin.auth.admin.getUserById(mapping.data.user_id);
      if (user.error) return NextResponse.json({ ok: false, error: "Existing login identity is unavailable." }, { status: 503 });
      existingLink = { userId: mapping.data.user_id, email: user.data.user?.email ?? null, driverId };
    }
  }
  return NextResponse.json({ ok: true, targetLogin, existingLink });
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const action = String(body?.action ?? "link");
    if (!email || !["link", "unlink"].includes(action)) return NextResponse.json({ ok: false, error: "Invalid email or action." }, { status: 400 });
    const lookup = await getUserIdByEmail(auth.supabaseAdmin, email);
    if (!lookup.ok) {
      console.error("[admin-driver-link] auth lookup failed", lookup.error);
      return NextResponse.json(
        { ok: false, error: "Auth user lookup is unavailable. Please retry.", code: "AUTH_LOOKUP_FAILED" },
        { status: 503 },
      );
    }
    const userId = lookup.userId;
    if (!userId) return NextResponse.json({ ok: false, error: "No auth user found for that email", code: "AUTH_USER_NOT_FOUND" }, { status: 404 });
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
