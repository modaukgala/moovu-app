import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isPushRole,
  verifyPushRoleAccess,
  type PushRole,
} from "@/lib/push-auth";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNestedString(source: unknown, path: string[]) {
  let current: unknown = source;

  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }

  return typeof current === "string" && current.trim() ? current : null;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing access token." },
        { status: 401 },
      );
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as unknown;
    const role = isRecord(body) ? String(body.role ?? "").trim() : "";
    const subscription = isRecord(body) ? body.subscription : null;

    const endpoint = readNestedString(subscription, ["endpoint"]);
    const p256dh = readNestedString(subscription, ["keys", "p256dh"]);
    const auth = readNestedString(subscription, ["keys", "auth"]);

    if (!isPushRole(role)) {
      return NextResponse.json({ ok: false, error: "Invalid role." }, { status: 400 });
    }

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { ok: false, error: "Missing subscription keys." },
        { status: 400 },
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    const roleAccess = await verifyPushRoleAccess(supabase, user.id, role as PushRole);
    if (!roleAccess.ok) {
      return NextResponse.json(
        { ok: false, error: roleAccess.error },
        { status: roleAccess.status },
      );
    }

    const payload = {
      user_id: user.id,
      role,
      endpoint,
      subscription,
      p256dh,
      auth,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(payload, { onConflict: "endpoint" });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: "Notifications enabled successfully.",
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Subscribe failed." },
      { status: 500 },
    );
  }
}
