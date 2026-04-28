import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ALLOWED_ADMIN_ROLES } from "@/lib/auth/admin";

type Role = "admin" | "driver" | "customer";

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
    const role = isRecord(body) ? (String(body.role ?? "").trim() as Role) : ("" as Role);
    const subscription = isRecord(body) ? body.subscription : null;

    const endpoint = readNestedString(subscription, ["endpoint"]);
    const p256dh = readNestedString(subscription, ["keys", "p256dh"]);
    const auth = readNestedString(subscription, ["keys", "auth"]);

    if (!["admin", "driver", "customer"].includes(role)) {
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

    if (role === "admin") {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError || !profile?.role || !ALLOWED_ADMIN_ROLES.includes(profile.role)) {
        return NextResponse.json(
          { ok: false, error: "Admin notification access required." },
          { status: 403 },
        );
      }
    }

    if (role === "driver") {
      const { data: driverAccount, error: driverError } = await supabase
        .from("driver_accounts")
        .select("driver_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (driverError || !driverAccount?.driver_id) {
        return NextResponse.json(
          { ok: false, error: "Driver notification access required." },
          { status: 403 },
        );
      }
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
