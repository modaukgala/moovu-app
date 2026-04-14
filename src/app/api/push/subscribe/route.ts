import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Role = "admin" | "driver" | "customer";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing access token." },
        { status: 401 }
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
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 }
      );
    }

    const body = await req.json();

    const role = String(body?.role ?? "").trim() as Role;
    const subscription = body?.subscription;

    const endpoint = subscription?.endpoint ?? null;
    const p256dh = subscription?.keys?.p256dh ?? null;
    const auth = subscription?.keys?.auth ?? null;

    if (!["admin", "driver", "customer"].includes(role)) {
      return NextResponse.json(
        { ok: false, error: "Invalid role." },
        { status: 400 }
      );
    }

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { ok: false, error: "Missing subscription keys." },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

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
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Notifications enabled successfully ✅",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Subscribe failed." },
      { status: 500 }
    );
  }
}