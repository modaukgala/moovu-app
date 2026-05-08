import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushSafe } from "@/lib/push-server";
import { isPushRole, verifyPushRoleAccess } from "@/lib/push-auth";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

    const body = (await req.json().catch(() => ({}))) as unknown;
    const role = isRecord(body) ? String(body.role ?? "").trim() : "";

    if (!isPushRole(role)) {
      return NextResponse.json(
        { ok: false, error: "Invalid role." },
        { status: 400 }
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

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const roleAccess = await verifyPushRoleAccess(supabaseAdmin, user.id, role);
    if (!roleAccess.ok) {
      return NextResponse.json(
        { ok: false, error: roleAccess.error },
        { status: roleAccess.status }
      );
    }

    const result = await sendPushSafe({
      userIds: [user.id],
      role,
      title: "MOOVU notifications enabled",
      body: `You will now receive ${role} notifications on this device.`,
      url: role === "driver" ? "/driver" : role === "admin" ? "/admin" : "/book",
    });

    if (!result.ok || result.delivered <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            result.message ||
            "Notification token was saved, but no test notification was delivered.",
          result,
        },
        { status: 424 }
      );
    }

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Push self-test failed." },
      { status: 500 }
    );
  }
}
