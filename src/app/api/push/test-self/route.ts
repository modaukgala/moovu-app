import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushSafe } from "@/lib/push-server";

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

    const body = await req.json().catch(() => ({}));
    const role = String(body?.role ?? "").trim() as Role;

    if (!["admin", "driver", "customer"].includes(role)) {
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

    const result = await sendPushSafe({
      userIds: [user.id],
      title: "MOOVU notifications enabled",
      body: `You will now receive ${role} notifications on this device.`,
      url: role === "driver" ? "/driver" : role === "admin" ? "/admin" : "/book",
    });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Push self-test failed." },
      { status: 500 }
    );
  }
}